package org.vegadelivery.app.data

import android.net.Uri

/** Login QR content: code and the server it belongs to (format v3). */
data class LoginQR(val code: String, val server: String?)

/**
 * QR format v3 (docs/APP-API.md):
 *   vegadelivery://login?v=3&s=<server base URL, URL-encoded>&c=<20 characters Crockford Base32>
 * Typed codes may contain dashes/spaces; I/L are read as 1 and O as 0.
 */
object LoginCode {
    const val LENGTH = 20
    private const val SCHEME = "vegadelivery://login"
    private val CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ".toSet()

    fun normalize(input: String): String? {
        val s = input.uppercase()
            .replace(Regex("[\\s\\-_]"), "")
            .replace('I', '1').replace('L', '1').replace('O', '0')
        return if (s.length == LENGTH && s.all { it in CROCKFORD }) s else null
    }

    /** Parses query parameters without android.net.Uri so it also works in unit tests. */
    fun fromQR(payload: String?): LoginQR? {
        val p = payload?.trim() ?: return null
        if (!p.lowercase().startsWith(SCHEME)) return null
        val query = p.substringAfter('?', "")
        val params = query.split('&').mapNotNull {
            val k = it.substringBefore('=', "")
            if (k.isEmpty()) null else k to java.net.URLDecoder.decode(it.substringAfter('=', ""), "UTF-8")
        }.toMap()
        val code = normalize(params["c"] ?: return null) ?: return null
        return LoginQR(code, params["s"]?.let { ServerUrl.normalize(it) })
    }

    fun fromUri(uri: Uri?): LoginQR? = fromQR(uri?.toString())
}

/** Server address: adds a scheme; public hosts always use https (a redirect would turn POST into GET). */
object ServerUrl {
    fun normalize(input: String): String? {
        var raw = input.trim().trimEnd('/')
        if (raw.isEmpty()) return null
        if (!raw.contains("://")) raw = "http://$raw"
        val scheme = raw.substringBefore("://").lowercase()
        if (scheme != "http" && scheme != "https") return null
        val rest = raw.substringAfter("://")
        val host = rest.substringBefore('/').substringBefore(':')
        if (host.isEmpty()) return null
        return if (scheme == "http" && !isLocal(host)) "https://$rest" else "$scheme://$rest"
    }

    fun isLocal(host: String): Boolean {
        val h = host.lowercase()
        if (h in setOf("localhost", "127.0.0.1", "10.0.2.2") || h.endsWith(".local") || !h.contains('.')) return true
        val o = h.split('.').mapNotNull { it.toIntOrNull() }
        if (o.size != 4) return false
        return o[0] == 10 || o[0] == 127 || (o[0] == 192 && o[1] == 168) || (o[0] == 172 && o[1] in 16..31)
    }
}

/** Scanned values: EAN digits and the customer name from the EAN-8 composite's 2D part. */
object ScanCode {
    fun gtin(raw: String): String {
        var s = raw
        if (s.startsWith("]") && s.length > 3) s = s.substring(3)
        return s.substringBefore('|').filter { it.isDigit() }
    }

    /** "(91)Herbert_M%C3%BCller" or raw "91…" → "Herbert Müller" */
    fun compositeName(raw: String): String? {
        val payload = when {
            raw.contains("(91)") -> raw.substringAfter("(91)")
            else -> {
                var s = raw
                if (s.startsWith("]") && s.length > 3) s = s.substring(3)
                s = s.trimStart('\u001d')
                if (!s.startsWith("91") || s.length <= 2) return null
                s.substring(2)
            }
        }
        val spaced = payload.replace('_', ' ')
        return try {
            java.net.URLDecoder.decode(spaced.replace("+", "%2B"), "UTF-8")
        } catch (e: IllegalArgumentException) {
            spaced
        }
    }
}
