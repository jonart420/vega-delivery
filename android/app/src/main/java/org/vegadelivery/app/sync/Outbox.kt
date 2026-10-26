package org.vegadelivery.app.sync

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Update
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.ApiException
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Delivery event waiting for (or already sent to) the server. Events are stored first and sent when
 * the network allows; `clientId` makes resending idempotent.
 */
@Entity(tableName = "pending_events")
data class PendingEvent(
    @PrimaryKey val clientId: String,
    val tourId: String,
    val stopId: String,
    /** outcome | arrived | note */
    val type: String,
    val outcomeCode: String?,
    val completesStop: Boolean,
    val isSuccess: Boolean,
    /** JSON sent as `meta` */
    val meta: String,
    val photoPath: String?,
    val signaturePath: String?,
    val createdAt: Long = System.currentTimeMillis(),
    val attempts: Int = 0,
    val lastError: String? = null,
    val sentAt: Long? = null,
    val rejected: Boolean = false,
)

@Dao
interface PendingEventDao {
    @Insert suspend fun insert(event: PendingEvent)
    @Update suspend fun update(event: PendingEvent)
    @Query("DELETE FROM pending_events WHERE clientId = :clientId") suspend fun delete(clientId: String)
    @Query("DELETE FROM pending_events") suspend fun clear()
    @Query("SELECT * FROM pending_events WHERE sentAt IS NULL AND rejected = 0 ORDER BY createdAt") suspend fun unsent(): List<PendingEvent>
    @Query("SELECT * FROM pending_events WHERE tourId = :tourId ORDER BY createdAt") fun forTour(tourId: String): Flow<List<PendingEvent>>
    @Query("SELECT COUNT(*) FROM pending_events WHERE sentAt IS NULL AND rejected = 0") fun pendingCount(): Flow<Int>
    @Query("SELECT COUNT(*) FROM pending_events WHERE rejected = 1") fun rejectedCount(): Flow<Int>
}

@Database(entities = [PendingEvent::class], version = 1, exportSchema = false)
abstract class AppDatabase : RoomDatabase() {
    abstract fun events(): PendingEventDao

    companion object {
        fun create(context: Context): AppDatabase =
            Room.databaseBuilder(context, AppDatabase::class.java, "vegadelivery.db").build()
    }
}

/** Files for proofs of delivery until they were sent. */
object ProofFiles {
    fun dir(context: Context): File = File(context.filesDir, "proofs").apply { mkdirs() }
    fun file(context: Context, name: String?): File? = name?.let { File(dir(context), it) }?.takeIf { it.exists() }
    fun delete(context: Context, name: String?) {
        file(context, name)?.delete()
    }
}

/** Sends stored events oldest first. Rejected (4xx) events are kept for the driver to see. */
class Outbox(private val context: Context, private val dao: PendingEventDao) {
    private val mutex = Mutex()

    val pendingCount = dao.pendingCount()
    val rejectedCount = dao.rejectedCount()

    fun eventsFor(tourId: String) = dao.forTour(tourId)

    suspend fun enqueue(event: PendingEvent) {
        dao.insert(event)
        schedule()
    }

    suspend fun discard(event: PendingEvent) {
        ProofFiles.delete(context, event.photoPath)
        ProofFiles.delete(context, event.signaturePath)
        dao.delete(event.clientId)
    }

    suspend fun clear() = dao.clear()

    /** Background delivery via WorkManager (runs as soon as a network is available, with backoff). */
    fun schedule() {
        val request = OneTimeWorkRequestBuilder<OutboxWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("outbox", ExistingWorkPolicy.REPLACE, request)
    }

    /** @return true when everything was sent (or rejected), false to retry later */
    suspend fun flush(): Boolean = mutex.withLock {
        val api = VegaApp.state.api() ?: return@withLock false
        for (event in dao.unsent()) {
            try {
                api.postEvent(event.tourId, event.meta, ProofFiles.file(context, event.photoPath), ProofFiles.file(context, event.signaturePath))
                dao.update(event.copy(sentAt = System.currentTimeMillis(), lastError = null))
                ProofFiles.delete(context, event.photoPath)
                ProofFiles.delete(context, event.signaturePath)
            } catch (e: ApiException.Server) {
                if (e.isRejection) {
                    dao.update(event.copy(rejected = true, lastError = e.message))
                } else {
                    dao.update(event.copy(attempts = event.attempts + 1, lastError = e.message))
                    return@withLock false
                }
            } catch (e: ApiException) {
                dao.update(event.copy(attempts = event.attempts + 1, lastError = e.message))
                return@withLock false
            }
        }
        true
    }
}

class OutboxWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = if (VegaApp.outbox.flush()) Result.success() else Result.retry()
}

/** Local view of a stop: server state from the tour package overlaid with the driver's own events. */
sealed class StopState {
    data object Open : StopState()
    data object Arrived : StopState()
    data class Delivered(val outcome: String?) : StopState()
    data class Failed(val outcome: String?) : StopState()
    data class Rejected(val message: String) : StopState()

    val isCompleted get() = this is Delivered || this is Failed

    companion object {
        fun compute(pkg: org.vegadelivery.app.data.TourPackage, events: List<PendingEvent>): Map<String, StopState> {
            val out = mutableMapOf<String, StopState>()
            for (stop in pkg.stops) {
                out[stop.id] = when (stop.status) {
                    "delivered" -> Delivered(stop.outcomeCode)
                    "failed", "skipped" -> Failed(stop.outcomeCode)
                    "arrived" -> Arrived
                    else -> Open
                }
            }
            for (e in events.filter { it.tourId == pkg.tour.id }) {
                when {
                    e.rejected -> out[e.stopId] = Rejected(e.lastError ?: "")
                    e.completesStop -> out[e.stopId] = if (e.isSuccess) Delivered(e.outcomeCode) else Failed(e.outcomeCode)
                    e.type == "arrived" && out[e.stopId] == Open -> out[e.stopId] = Arrived
                }
            }
            return out
        }
    }
}
