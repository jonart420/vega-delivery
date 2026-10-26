package org.vegadelivery.app.ui

import android.Manifest
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.vegadelivery.app.R
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.TourPackage
import org.vegadelivery.app.data.TourStop
import org.vegadelivery.app.location.LiveLocationService
import org.vegadelivery.app.sync.StopState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TourDetailScreen(tourId: String, onBack: () -> Unit, onNavigate: () -> Unit) {
    val state = VegaApp.state
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config by state.config.collectAsState()
    var pkg by remember { mutableStateOf(state.cachedPackage(tourId)) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var openStop by remember { mutableStateOf<TourStop?>(null) }
    var confirmFinish by remember { mutableStateOf(false) }
    val events by VegaApp.outbox.eventsFor(tourId).collectAsState(initial = emptyList())
    val states = pkg?.let { StopState.compute(it, events) } ?: emptyMap()
    val openCount = states.values.count { !it.isCompleted }

    suspend fun load() {
        try {
            pkg = state.loadPackage(tourId).first
            error = null
        } catch (e: Exception) {
            error = e.message
        }
    }
    LaunchedEffect(tourId) { load() }

    val permissions = rememberPermissionsRequest { granted ->
        if (granted && pkg?.tour?.status == "in_progress") LiveLocationService.start(context, tourId)
    }

    LaunchedEffect(pkg?.tour?.status) {
        if (pkg?.tour?.status == "in_progress") {
            if (context.hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) LiveLocationService.start(context, tourId)
            else permissions.launch(trackingPermissions)
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(pkg?.tour?.title ?: "") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null) } },
        )
    }) { padding ->
        val p = pkg
        if (p == null) {
            Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                if (error != null) Text(error ?: "", Modifier.padding(24.dp)) else CircularProgressIndicator()
            }
            return@Scaffold
        }
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            item {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        listOfNotNull(Format.date(p.tour.date), p.tour.plannedStart, p.tour.vehicle).joinToString("  ·  "),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        listOfNotNull(
                            stringResource(R.string.stops_done, p.stops.size - openCount, p.stops.size),
                            p.tour.route?.let { Format.distance(it.distanceKm) },
                        ).joinToString("  ·  "),
                    )
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    when (p.tour.status) {
                        "released" -> {
                            Button(
                                onClick = {
                                    busy = true
                                    scope.launch {
                                        try {
                                            state.startTour(tourId)
                                            load()
                                            onNavigate()
                                        } catch (e: Exception) {
                                            error = e.message
                                        }
                                        busy = false
                                    }
                                },
                                enabled = !busy,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(stringResource(R.string.start_tour)) }
                            Text(stringResource(R.string.start_hint, config?.notifyLeadStops ?: 3), style = MaterialTheme.typography.bodySmall)
                        }
                        "in_progress" -> {
                            Button(onClick = onNavigate, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.navigate)) }
                            OutlinedButton(onClick = { confirmFinish = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(R.string.finish_tour))
                            }
                        }
                        else -> Text(stringResource(R.string.tour_finished), color = MaterialTheme.colorScheme.primary)
                    }
                    events.filter { it.rejected }.forEach { e ->
                        Column {
                            Text(p.stops.firstOrNull { it.id == e.stopId }?.name ?: e.stopId, style = MaterialTheme.typography.titleSmall)
                            Text(e.lastError ?: "", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                            TextButton(onClick = { scope.launch { VegaApp.outbox.discard(e) } }) { Text(stringResource(R.string.discard)) }
                        }
                    }
                }
                Text(stringResource(R.string.stops).uppercase(), Modifier.padding(16.dp, 8.dp), style = MaterialTheme.typography.labelMedium)
            }
            items(p.stops, key = { it.id }) { stop ->
                StopRow(stop, states[stop.id] ?: StopState.Open) { openStop = stop }
                HorizontalDivider()
            }
        }
    }

    openStop?.let { stop ->
        val p = pkg ?: return@let
        StopSheet(
            pkg = p,
            stop = stop,
            state = states[stop.id] ?: StopState.Open,
            canRecord = p.tour.status == "in_progress",
            onDone = { openStop = null },
        )
    }

    if (confirmFinish) {
        AlertDialog(
            onDismissRequest = { confirmFinish = false },
            title = { Text(stringResource(R.string.finish_tour)) },
            text = { if (openCount > 0) Text(stringResource(R.string.finish_confirm, openCount)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmFinish = false
                    busy = true
                    scope.launch {
                        try {
                            state.finishTour(tourId)
                            LiveLocationService.stop(context)
                            load()
                        } catch (e: Exception) {
                            error = e.message
                        }
                        busy = false
                    }
                }) { Text(stringResource(R.string.finish_tour)) }
            },
            dismissButton = { TextButton(onClick = { confirmFinish = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun StopRow(stop: TourStop, state: StopState, onClick: () -> Unit) {
    val color = when (state) {
        is StopState.Delivered -> Color(0xFF16A34A)
        is StopState.Failed, is StopState.Rejected -> Color(0xFFDC2626)
        StopState.Arrived -> Color(0xFFF59E0B)
        StopState.Open -> Color.Gray
    }
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(28.dp).background(color, CircleShape), contentAlignment = Alignment.Center) {
            Text(stop.position?.toString() ?: "•", color = Color.White, style = MaterialTheme.typography.labelMedium)
        }
        Column(Modifier.weight(1f)) {
            Text(stop.name, style = MaterialTheme.typography.titleSmall)
            Text(stop.addressLine, style = MaterialTheme.typography.bodySmall)
            Text(
                listOfNotNull(Format.time(stop.eta)?.let { "ETA $it" }, stringResource(R.string.orders_count, stop.orders.size)).joinToString("  ·  "),
                style = MaterialTheme.typography.bodySmall,
            )
            if (state is StopState.Rejected) Text(state.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Ids of stops already completed (server state or own events). */
fun completedStops(pkg: TourPackage, events: List<org.vegadelivery.app.sync.PendingEvent>): Set<String> =
    StopState.compute(pkg, events).filterValues { it.isCompleted }.keys
