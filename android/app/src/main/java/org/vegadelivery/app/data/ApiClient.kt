package org.vegadelivery.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNamingStrategy
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit

/** Error from the server. 4xx (except 408/429) = rejected, never retried; network = retry later. */
sealed class ApiException(message: String) : Exception(message) {
    class Unauthorized(message: String) : ApiException(message)
    class Server(message: String, val status: Int, val code: String?) : ApiException(message) {
        val isRejection get() = status in 400..499 && status != 408 && status != 429
    }
    class Network(message: String) : ApiException(message)
}

@OptIn(ExperimentalSerializationApi::class)
val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    namingStrategy = JsonNamingStrategy.SnakeCase
}

/** Access to the delivery server (/api/app/…). */
class ApiClient(val baseUrl: String, private val token: String?) {
    companion object {
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            .build()
        private val JSON = "application/json".toMediaType()
    }

    @Serializable private data class LoginBody(val code: String, val deviceName: String, val platform: String = "android")
    @Serializable private data class LoginResponse(val token: String, val user: AppUser)
    @Serializable private data class ToursResponse(val tours: List<TourSummary>)
    @Serializable private data class StatusResponse(val status: String? = null)
    @Serializable private data class QueuedResponse(val queued: Int = 0)
    @Serializable private data class PositionsBody(val points: List<PositionPoint>)
    @Serializable private data class StopBody(val stopId: String)

    suspend fun login(code: String, deviceName: String): Pair<String, AppUser> {
        val r = ApiJson.decodeFromString<LoginResponse>(post("api/app/login", ApiJson.encodeToString(LoginBody(code, deviceName))))
        return r.token to r.user
    }

    suspend fun logout() {
        runCatching { post("api/app/logout", "{}") }
    }

    /** Returns the decoded config and the raw JSON (for the offline copy). */
    suspend fun config(): Pair<AppConfig, String> {
        val raw = get("api/app/config")
        return ApiJson.decodeFromString<AppConfig>(raw) to raw
    }

    suspend fun tours(): List<TourSummary> = ApiJson.decodeFromString<ToursResponse>(get("api/app/tours")).tours

    suspend fun tourPackage(id: String): Pair<TourPackage, String> {
        val raw = get("api/app/tours/$id")
        return ApiJson.decodeFromString<TourPackage>(raw) to raw
    }

    suspend fun startTour(id: String): String? = ApiJson.decodeFromString<StatusResponse>(post("api/app/tours/$id/start", "{}")).status
    suspend fun finishTour(id: String): String? = ApiJson.decodeFromString<StatusResponse>(post("api/app/tours/$id/finish", "{}")).status

    suspend fun notify(tourId: String, stopId: String): Int =
        ApiJson.decodeFromString<QueuedResponse>(post("api/app/tours/$tourId/notify", ApiJson.encodeToString(StopBody(stopId)))).queued

    suspend fun postPositions(tourId: String, points: List<PositionPoint>) {
        post("api/app/tours/$tourId/position", ApiJson.encodeToString(PositionsBody(points)))
    }

    /** Delivery event; with proof files as multipart/form-data (`meta` + `photo` / `signature`). */
    suspend fun postEvent(tourId: String, meta: String, photo: File?, signature: File?) {
        val path = "api/app/tours/$tourId/events"
        if (photo == null && signature == null) {
            post(path, meta)
            return
        }
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            addFormDataPart("meta", meta)
            photo?.let { addFormDataPart("photo", it.name, it.asRequestBody("image/jpeg".toMediaType())) }
            signature?.let { addFormDataPart("signature", it.name, it.asRequestBody("image/png".toMediaType())) }
        }.build()
        execute(request(path).post(body).build())
    }

    suspend fun health() {
        get("api/health")
    }

    // ── internal ──────────────────────────────────────────────────────────

    private fun request(path: String): Request.Builder = Request.Builder()
        .url("${baseUrl.trimEnd('/')}/$path")
        .header("Accept", "application/json")
        .header("Accept-Language", Locale.getDefault().language)
        .apply { token?.let { header("Authorization", "Bearer $it") } }

    private suspend fun get(path: String): String = execute(request(path).get().build())

    private suspend fun post(path: String, json: String): String =
        execute(request(path).post(json.toRequestBody(JSON) as RequestBody).build())

    private suspend fun execute(req: Request): String = withContext(Dispatchers.IO) {
        val response = try {
            http.newCall(req).execute()
        } catch (e: IOException) {
            throw ApiException.Network(e.message ?: e.javaClass.simpleName)
        }
        response.use { res ->
            val text = res.body.string()
            if (res.isSuccessful) return@withContext text
            val obj = runCatching { ApiJson.parseToJsonElement(text) as? JsonObject }.getOrNull()
            val message = obj?.get("error")?.jsonPrimitive?.contentOrNull ?: "Error ${res.code}"
            if (res.code == 401) throw ApiException.Unauthorized(message)
            throw ApiException.Server(message, res.code, obj?.get("code")?.jsonPrimitive?.contentOrNull)
        }
    }
}
