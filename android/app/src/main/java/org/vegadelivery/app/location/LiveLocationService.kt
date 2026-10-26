package org.vegadelivery.app.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.vegadelivery.app.MainActivity
import org.vegadelivery.app.R
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.PositionPoint
import java.time.Instant

/**
 * Foreground service sharing the vehicle position of a running tour with the server (tracking
 * links, dispatcher map): a point every 15 s or 100 m, batched and kept while offline.
 * Uses the platform LocationManager – no Google Play services required.
 */
class LiveLocationService : LifecycleService(), LocationListener {
    companion object {
        private const val CHANNEL = "live_tracking"
        private const val EXTRA_TOUR = "tour_id"
        private const val MIN_INTERVAL_MS = 15_000L
        private const val MIN_DISTANCE_M = 100f
        private const val MAX_BUFFER = 2000

        fun start(context: Context, tourId: String) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
            ContextCompat.startForegroundService(context, Intent(context, LiveLocationService::class.java).putExtra(EXTRA_TOUR, tourId))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LiveLocationService::class.java))
        }
    }

    private var tourId: String? = null
    private val buffer = mutableListOf<PositionPoint>()
    private var lastKept: Location? = null
    private var lastSent = 0L
    private var sending = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        tourId = intent?.getStringExtra(EXTRA_TOUR) ?: tourId
        startInForeground()
        requestUpdates()
        return START_REDELIVER_INTENT
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.live_tracking), NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.live_tracking))
            .setContentText(getString(R.string.live_tracking_text))
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, 1, notification, type)
    }

    @SuppressLint("MissingPermission")
    private fun requestUpdates() {
        val lm = getSystemService(LocationManager::class.java)
        lm.removeUpdates(this)
        val provider = if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) LocationManager.GPS_PROVIDER else LocationManager.NETWORK_PROVIDER
        runCatching { lm.requestLocationUpdates(provider, 5_000L, 20f, this, Looper.getMainLooper()) }
    }

    override fun onLocationChanged(location: Location) {
        if (tourId == null || location.accuracy > 100) return
        val last = lastKept
        if (last != null && location.time - last.time < MIN_INTERVAL_MS && location.distanceTo(last) < MIN_DISTANCE_M) return
        lastKept = location
        buffer += PositionPoint(
            t = Instant.ofEpochMilli(location.time).toString(),
            lat = location.latitude,
            lon = location.longitude,
            acc = location.accuracy.toDouble(),
            speed = if (location.hasSpeed()) location.speed.toDouble() else null,
            heading = if (location.hasBearing()) location.bearing.toDouble() else null,
        )
        if (buffer.size > MAX_BUFFER) buffer.subList(0, buffer.size - MAX_BUFFER).clear()
        if (System.currentTimeMillis() - lastSent >= MIN_INTERVAL_MS) send()
    }

    private fun send() {
        val id = tourId ?: return
        if (sending || buffer.isEmpty()) return
        val api = VegaApp.state.api() ?: return
        sending = true
        val batch = buffer.toList()
        lifecycleScope.launch {
            try {
                api.postPositions(id, batch)
                buffer.subList(0, minOf(batch.size, buffer.size)).clear()
            } catch (_: Exception) {
                // offline: keep the points, the next location triggers another attempt
            } finally {
                lastSent = System.currentTimeMillis()
                sending = false
            }
        }
    }

    override fun onDestroy() {
        getSystemService(LocationManager::class.java).removeUpdates(this)
        super.onDestroy()
    }
}
