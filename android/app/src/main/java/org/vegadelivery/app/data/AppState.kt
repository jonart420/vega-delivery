package org.vegadelivery.app.data

import android.content.Context
import android.os.Build
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.vegadelivery.app.BuildConfig
import org.vegadelivery.app.VegaApp
import java.io.File

/** Central state: server, sign-in, configuration, tours – with offline copies on disk. */
class AppState(private val context: Context) {
    private val prefs = context.getSharedPreferences("vegadelivery", Context.MODE_PRIVATE)
    private val cacheDir = File(context.filesDir, "tours").apply { mkdirs() }

    private val _user = MutableStateFlow(prefs.getString("user", null)?.let { runCatching { ApiJson.decodeFromString<AppUser>(it) }.getOrNull() })
    val user: StateFlow<AppUser?> = _user.asStateFlow()

    private val _config = MutableStateFlow(readCache("config.json")?.let { runCatching { ApiJson.decodeFromString<AppConfig>(it) }.getOrNull() })
    val config: StateFlow<AppConfig?> = _config.asStateFlow()

    private val _tours = MutableStateFlow(readCache("list.json")?.let { runCatching { ApiJson.decodeFromString<List<TourSummary>>(it) }.getOrNull() } ?: emptyList())
    val tours: StateFlow<List<TourSummary>> = _tours.asStateFlow()

    val offline = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)

    var serverUrl: String
        get() = prefs.getString("server", null) ?: BuildConfig.DEFAULT_SERVER_URL
        set(value) = prefs.edit().putString("server", value).apply()

    /** Stored in app-private preferences (not readable by other apps). */
    private var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().putString("token", value).apply()

    val deviceToken: String? get() = token
    val isLoggedIn get() = token != null && _user.value != null

    fun api(): ApiClient? = ServerUrl.normalize(serverUrl)?.let { ApiClient(it, token) }

    // ── sign-in ───────────────────────────────────────────────────────────

    suspend fun login(qr: LoginQR): Boolean {
        qr.server?.let { serverUrl = it }
        return login(qr.code)
    }

    suspend fun login(code: String): Boolean {
        val api = api() ?: run { error.value = "Invalid server address"; return false }
        return try {
            val (t, u) = api.login(code, "${Build.MANUFACTURER} ${Build.MODEL}")
            token = t
            setUser(u)
            error.value = null
            refreshConfig()
            refreshTours()
            true
        } catch (e: ApiException) {
            error.value = e.message
            false
        }
    }

    suspend fun logout() {
        api()?.logout()
        token = null
        setUser(null)
        _tours.value = emptyList()
        _config.value = null
        cacheDir.listFiles()?.forEach { it.delete() }
        VegaApp.outbox.clear()
    }

    private fun setUser(u: AppUser?) {
        _user.value = u
        prefs.edit().putString("user", u?.let { ApiJson.encodeToString(it) }).apply()
    }

    private fun unauthorized(message: String?) {
        token = null
        setUser(null)
        error.value = message
    }

    // ── data ──────────────────────────────────────────────────────────────

    suspend fun refreshConfig() {
        val api = api() ?: return
        if (token == null) return
        try {
            val (cfg, raw) = api.config()
            _config.value = cfg
            writeCache("config.json", raw)
        } catch (e: ApiException.Unauthorized) {
            unauthorized(e.message)
        } catch (_: ApiException) {
            // keep the cached configuration
        }
    }

    suspend fun refreshTours() {
        val api = api() ?: return
        if (token == null) return
        try {
            val list = api.tours()
            _tours.value = list
            writeCache("list.json", ApiJson.encodeToString(list))
            offline.value = false
            error.value = null
        } catch (e: ApiException.Unauthorized) {
            unauthorized(e.message)
        } catch (_: ApiException.Network) {
            offline.value = true
        } catch (e: ApiException) {
            error.value = e.message
        }
    }

    /** Last loaded packages (shared by detail, stop and navigation screens). */
    private val packages = mutableMapOf<String, TourPackage>()

    fun cachedPackage(id: String): TourPackage? =
        packages[id] ?: readCache("tour-$id.json")?.let { runCatching { ApiJson.decodeFromString<TourPackage>(it) }.getOrNull() }

    /** Tour package: network preferred, otherwise the offline copy. Second value: from cache. */
    suspend fun loadPackage(id: String): Pair<TourPackage, Boolean> {
        api()?.takeIf { token != null }?.let { api ->
            try {
                val (pkg, raw) = api.tourPackage(id)
                writeCache("tour-$id.json", raw)
                packages[id] = pkg
                return pkg to false
            } catch (_: ApiException.Network) {
                // offline → fallback below
            }
        }
        val cached = readCache("tour-$id.json") ?: throw ApiException.Network("Tour is not saved for offline use yet")
        return ApiJson.decodeFromString<TourPackage>(cached) to true
    }

    suspend fun startTour(id: String) {
        api()?.startTour(id)
        refreshTours()
    }

    suspend fun finishTour(id: String) {
        VegaApp.outbox.flush()
        api()?.finishTour(id)
        refreshTours()
    }

    private fun readCache(name: String): String? = File(cacheDir, name).takeIf { it.exists() }?.readText()
    private fun writeCache(name: String, text: String) = File(cacheDir, name).writeText(text)
}
