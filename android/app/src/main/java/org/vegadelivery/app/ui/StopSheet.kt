package org.vegadelivery.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.BitmapFactory
import android.location.LocationManager
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.vegadelivery.app.R
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.DeliveryOutcome
import org.vegadelivery.app.data.DeliveryReason
import org.vegadelivery.app.data.ScanCode
import org.vegadelivery.app.data.TourPackage
import org.vegadelivery.app.data.TourStop
import org.vegadelivery.app.data.parseHexColor
import org.vegadelivery.app.sync.PendingEvent
import org.vegadelivery.app.sync.ProofFiles
import org.vegadelivery.app.sync.StopState
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * Everything about one stop (customer, address, orders, contact) and the outcome buttons configured
 * in the back office. `onDone(outcome)` is called with the recorded outcome or null when closed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StopSheet(pkg: TourPackage, stop: TourStop, state: StopState, canRecord: Boolean, onDone: (DeliveryOutcome?) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config by VegaApp.state.config.collectAsState()
    val outcomes = (config?.outcomes ?: emptyList()).sortedBy { it.sort }
    var selected by remember { mutableStateOf<DeliveryOutcome?>(null) }
    var recordAgain by remember { mutableStateOf(false) }
    var notifyResult by remember { mutableStateOf<String?>(null) }
    val notifiedText = stringResource(R.string.notified)
    val notNotifiedText = stringResource(R.string.not_notified)

    Dialog(onDismissRequest = { onDone(null) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        selected?.let { outcome ->
            OutcomeForm(pkg, stop, outcome, onBack = { selected = null }, onSaved = { onDone(outcome) })
            return@Dialog
        }
        Scaffold(topBar = {
            TopAppBar(
                title = { Text(stop.position?.let { stringResource(R.string.stop_n, it) } ?: stop.name) },
                navigationIcon = { IconButton(onClick = { onDone(null) }) { Icon(Icons.Filled.Close, stringResource(R.string.close)) } },
            )
        }) { padding ->
            Column(
                Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(stop.name, style = MaterialTheme.typography.titleLarge)
                Text(stop.streetLine)
                stop.addressExtra?.let { Text(it) }
                Text("${stop.zip} ${stop.city}")
                Text(
                    listOfNotNull(
                        stringResource(R.string.customer_no, stop.customerNo),
                        Format.time(stop.eta)?.let { stringResource(R.string.eta, it) },
                        listOfNotNull(stop.timeWindowFrom, stop.timeWindowTo).takeIf { it.isNotEmpty() }?.joinToString("–"),
                    ).joinToString("  ·  "),
                    style = MaterialTheme.typography.bodySmall,
                )
                stop.deliveryNotes?.takeIf { it.isNotBlank() }?.let { Text(it, color = Color(0xFFD97706), fontWeight = FontWeight.SemiBold) }
                when (state) {
                    is StopState.Delivered -> Text(outcomeLabel(outcomes, state.outcome) ?: stringResource(R.string.delivered), color = Color(0xFF16A34A))
                    is StopState.Failed -> Text(outcomeLabel(outcomes, state.outcome) ?: stringResource(R.string.not_delivered), color = Color(0xFFDC2626))
                    is StopState.Rejected -> Text(state.message, color = MaterialTheme.colorScheme.error)
                    else -> {}
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    stop.phone?.let { phone ->
                        OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:${phone.filter { it.isDigit() || it == '+' }}"))) }) {
                            Text(stringResource(R.string.call))
                        }
                    }
                    stop.whatsapp?.let { wa ->
                        OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/${wa.filter { it.isDigit() }}"))) }) {
                            Text(stringResource(R.string.whatsapp))
                        }
                    }
                    if (stop.lat != null && stop.lon != null) {
                        OutlinedButton(onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("geo:${stop.lat},${stop.lon}?q=${stop.lat},${stop.lon}"))) }) {
                            Text(stringResource(R.string.maps))
                        }
                    }
                }
                if (canRecord) {
                    TextButton(onClick = {
                        scope.launch {
                            notifyResult = try {
                                if ((VegaApp.state.api()?.notify(pkg.tour.id, stop.id) ?: 0) > 0) notifiedText else notNotifiedText
                            } catch (e: Exception) {
                                e.message
                            }
                        }
                    }) { Text(stringResource(R.string.notify)) }
                    notifyResult?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }

                Text(stringResource(R.string.orders).uppercase(), style = MaterialTheme.typography.labelMedium)
                stop.orders.forEach { order ->
                    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp)).padding(12.dp)) {
                        Row {
                            Text(stringResource(R.string.order_n, order.orderNo), Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            Text(order.deliveryEan13, style = MaterialTheme.typography.bodySmall)
                        }
                        order.items.forEach { Text("${it.quantityText} × ${it.nameSnapshot}") }
                        order.notes?.let { Text(it, color = Color(0xFFD97706)) }
                    }
                }

                if (canRecord) {
                    if (state.isCompleted && !recordAgain) {
                        TextButton(onClick = { recordAgain = true }) { Text(stringResource(R.string.record_again)) }
                    } else {
                        Text(stringResource(R.string.outcome).uppercase(), style = MaterialTheme.typography.labelMedium)
                        outcomes.chunked(2).forEach { row ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                row.forEach { o ->
                                    val color = Color(parseHexColor(o.color) ?: if (o.isSuccess) 0xFF16A34A else 0xFFDC2626)
                                    Text(
                                        o.label,
                                        color = Color.White,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.weight(1f).heightIn(min = 64.dp)
                                            .background(color, RoundedCornerShape(12.dp))
                                            .clickable { selected = o }
                                            .padding(12.dp),
                                    )
                                }
                                if (row.size == 1) androidx.compose.foundation.layout.Spacer(Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun outcomeLabel(outcomes: List<DeliveryOutcome>, code: String?): String? = outcomes.firstOrNull { it.code == code }?.label

/** Form for one outcome; required fields follow the outcome's settings from the back office. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OutcomeForm(pkg: TourPackage, stop: TourStop, outcome: DeliveryOutcome, onBack: () -> Unit, onSaved: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val config by VegaApp.state.config.collectAsState()
    val scanAccept = config?.scanAccept ?: "any"
    val accepted = stop.acceptedCodes(scanAccept)
    var reason by remember { mutableStateOf<DeliveryReason?>(null) }
    var reasonMenu by remember { mutableStateOf(false) }
    var reasonText by remember { mutableStateOf("") }
    var recipient by remember { mutableStateOf("") }
    var neighbor by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var photo by remember { mutableStateOf<File?>(null) }
    var signature by remember { mutableStateOf<File?>(null) }
    val scanned = remember { mutableStateListOf<String>() }
    var manualCode by remember { mutableStateOf("") }
    var mode by remember { mutableStateOf("form") } // form | photo | signature | scan

    val validScan = scanned.any { ScanCode.gtin(it) in accepted }
    val missing = buildList {
        if (outcome.requiresReason && reason == null && reasonText.isBlank()) add(context.getString(R.string.reason))
        if (outcome.requiresRecipient && recipient.isBlank()) add(context.getString(R.string.recipient))
        if (outcome.requiresPhoto && photo == null) add(context.getString(R.string.photo))
        if (outcome.requiresSignature && signature == null) add(context.getString(R.string.signature))
        if (outcome.requiresScan && !validScan) add(context.getString(R.string.barcode_scan))
    }

    when (mode) {
        "photo" -> {
            PhotoCaptureScreen(onCaptured = { photo = it; mode = "form" }, onClose = { mode = "form" })
            return
        }
        "signature" -> {
            SignatureScreen(name = recipient, onSigned = { signature = it; mode = "form" }, onClose = { mode = "form" })
            return
        }
        "scan" -> {
            ScannerScreen(
                accept = { raw -> ScanCode.gtin(raw).length >= 8 },
                onResult = { raw -> if (raw !in scanned) scanned += raw; mode = "form" },
                onClose = { mode = "form" },
            )
            return
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(outcome.label) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.Filled.Close, stringResource(R.string.close)) } },
        )
    }) { padding ->
        Column(
            Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (outcome.reasons.isNotEmpty() || outcome.requiresReason) {
                Label(R.string.reason, outcome.requiresReason)
                if (outcome.reasons.isNotEmpty()) {
                    OutlinedButton(onClick = { reasonMenu = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(reason?.label ?: stringResource(R.string.choose))
                    }
                    DropdownMenu(expanded = reasonMenu, onDismissRequest = { reasonMenu = false }) {
                        outcome.reasons.forEach { r ->
                            DropdownMenuItem(text = { Text(r.label) }, onClick = { reason = r; reasonMenu = false })
                        }
                    }
                }
                OutlinedTextField(reasonText, { reasonText = it }, label = { Text(stringResource(R.string.details_optional)) }, modifier = Modifier.fillMaxWidth())
            }

            Label(R.string.recipient, outcome.requiresRecipient)
            OutlinedTextField(recipient, { recipient = it }, label = { Text(stringResource(R.string.recipient_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            if (outcome.code == "neighbor" || outcome.code == "safe_place") {
                OutlinedTextField(
                    neighbor, { neighbor = it },
                    label = { Text(stringResource(if (outcome.code == "neighbor") R.string.neighbor else R.string.safe_place)) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Label(R.string.photo, outcome.requiresPhoto)
            OutlinedButton(onClick = { mode = "photo" }) { Text(stringResource(R.string.take_photo)) }
            photo?.let { f -> BitmapFactory.decodeFile(f.path)?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxWidth().heightIn(max = 180.dp)) } }

            Label(R.string.signature, outcome.requiresSignature)
            OutlinedButton(onClick = { mode = "signature" }) { Text(stringResource(R.string.capture_signature)) }
            signature?.let { f -> BitmapFactory.decodeFile(f.path)?.let { Image(it.asImageBitmap(), null, Modifier.fillMaxWidth().heightIn(max = 120.dp).background(Color.White)) } }

            Label(R.string.barcode_scan, outcome.requiresScan)
            OutlinedButton(onClick = { mode = "scan" }) { Text(stringResource(R.string.scan_barcode)) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    manualCode, { manualCode = it.filter { c -> c.isDigit() } },
                    label = { Text(stringResource(R.string.type_code)) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = { if (manualCode.length >= 8 && manualCode !in scanned) scanned += manualCode; manualCode = "" }) {
                    Text(stringResource(R.string.add))
                }
            }
            scanned.forEach { raw ->
                val ok = ScanCode.gtin(raw) in accepted
                Text(
                    (if (ok) "✓ " else "? ") + ScanCode.gtin(raw) + (ScanCode.compositeName(raw)?.let { " – $it" } ?: ""),
                    color = if (ok) Color(0xFF16A34A) else Color(0xFFD97706),
                )
            }
            Text(
                when (scanAccept) {
                    "customer" -> stringResource(R.string.scan_hint_customer, stop.customerNo)
                    "delivery" -> stringResource(R.string.scan_hint_delivery)
                    else -> stringResource(R.string.scan_hint_any, stop.customerNo)
                },
                style = MaterialTheme.typography.bodySmall,
            )

            OutlinedTextField(note, { note = it }, label = { Text(stringResource(R.string.note)) }, modifier = Modifier.fillMaxWidth())

            Button(
                onClick = {
                    scope.launch {
                        VegaApp.outbox.enqueue(buildEvent(context, pkg, stop, outcome, reason, reasonText, recipient, neighbor, note, scanned, photo, signature))
                        onSaved()
                    }
                },
                enabled = missing.isEmpty(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(outcome.label) }
            if (missing.isNotEmpty()) Text(stringResource(R.string.missing, missing.joinToString(", ")), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun Label(text: Int, required: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(stringResource(text).uppercase(), style = MaterialTheme.typography.labelMedium)
        if (required) Text(stringResource(R.string.required), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.labelMedium)
    }
}

@SuppressLint("MissingPermission")
private fun buildEvent(
    context: android.content.Context, pkg: TourPackage, stop: TourStop, outcome: DeliveryOutcome, reason: DeliveryReason?,
    reasonText: String, recipient: String, neighbor: String, note: String, scanned: List<String>, photo: File?, signature: File?,
): PendingEvent {
    val clientId = UUID.randomUUID().toString()
    val location = runCatching {
        val lm = context.getSystemService(LocationManager::class.java)
        lm.getLastKnownLocation(LocationManager.GPS_PROVIDER) ?: lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
    }.getOrNull()
    val meta = buildJsonObject {
        put("client_id", clientId)
        put("stop_id", stop.id)
        put("type", "outcome")
        put("outcome_code", outcome.code)
        putJsonArray("scanned_codes") { scanned.forEach { add(JsonPrimitive(it)) } }
        put("occurred_at", Instant.now().toString())
        reason?.let { put("reason_id", it.id) }
        reasonText.trim().takeIf { it.isNotEmpty() }?.let { put("reason_text", it) }
        recipient.trim().takeIf { it.isNotEmpty() }?.let { put("recipient_name", it) }
        neighbor.trim().takeIf { it.isNotEmpty() }?.let { put("neighbor_info", it) }
        note.trim().takeIf { it.isNotEmpty() }?.let { put("note", it) }
        location?.let {
            put("lat", it.latitude)
            put("lon", it.longitude)
        }
    }
    // Proof files are moved into the outbox folder (deleted after sending)
    fun keep(f: File?, ext: String): String? = f?.let {
        val name = "${UUID.randomUUID()}.$ext"
        if (it.renameTo(File(ProofFiles.dir(context), name))) name else null
    }
    return PendingEvent(
        clientId = clientId, tourId = pkg.tour.id, stopId = stop.id, type = "outcome", outcomeCode = outcome.code,
        completesStop = outcome.completesStop, isSuccess = outcome.isSuccess, meta = meta.toString(),
        photoPath = keep(photo, "jpg"), signaturePath = keep(signature, "png"),
    )
}
