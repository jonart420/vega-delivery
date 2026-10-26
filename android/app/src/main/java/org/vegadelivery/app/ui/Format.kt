package org.vegadelivery.app.ui

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

object Format {
    fun date(iso: String?): String? = iso?.take(10)?.let {
        runCatching { LocalDate.parse(it).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)) }.getOrNull()
    }

    fun time(iso: String?): String? = iso?.let {
        runCatching {
            Instant.parse(it).atZone(ZoneId.systemDefault()).toLocalTime().format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT))
        }.getOrNull()
    }

    fun distance(km: Double): String =
        if (km < 1) "${(km * 1000).toInt()} m" else String.format(Locale.getDefault(), "%.1f km", km)
}
