package org.vegadelivery.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.vegadelivery.app.R
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.LoginCode

@Composable
fun LoginScreen(onLoggedIn: () -> Unit) {
    val state = VegaApp.state
    val scope = rememberCoroutineScope()
    val error by state.error.collectAsState()
    val config by state.config.collectAsState()
    var code by remember { mutableStateOf("") }
    var server by remember { mutableStateOf(state.serverUrl) }
    var showServer by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var scanning by remember { mutableStateOf(false) }

    fun login(block: suspend () -> Boolean) {
        busy = true
        scope.launch {
            val ok = block()
            busy = false
            if (ok) onLoggedIn()
        }
    }

    if (scanning) {
        ScannerScreen(
            accept = { raw -> LoginCode.fromQR(raw) != null },
            onResult = { raw ->
                scanning = false
                LoginCode.fromQR(raw)?.let { qr -> login { state.login(qr) } }
            },
            onClose = { scanning = false },
            qrOnly = true,
        )
        return
    }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(config?.brand?.name ?: stringResource(R.string.app_name), style = MaterialTheme.typography.headlineLarge)
        Text(stringResource(R.string.login_intro), style = MaterialTheme.typography.bodyMedium)
        Button(onClick = { scanning = true }, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Icon(Icons.Filled.QrCodeScanner, contentDescription = null)
            Spacer(Modifier.padding(4.dp))
            Text(stringResource(R.string.scan_code))
        }
        Text(stringResource(R.string.or_type_code), style = MaterialTheme.typography.labelLarge)
        OutlinedTextField(
            value = code,
            onValueChange = { code = it },
            placeholder = { Text("XXXX-XXXX-XXXX-XXXX-XXXX") },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
            isError = code.isNotBlank() && LoginCode.normalize(code) == null && code.filter { it.isLetterOrDigit() }.length >= LoginCode.LENGTH,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(
            onClick = { LoginCode.normalize(code)?.let { c -> login { state.login(c) } } },
            enabled = !busy && LoginCode.normalize(code) != null,
        ) { Text(stringResource(R.string.sign_in)) }
        if (busy) CircularProgressIndicator()
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        TextButton(onClick = { showServer = !showServer }) { Text(stringResource(R.string.server)) }
        if (showServer) {
            OutlinedTextField(
                value = server,
                onValueChange = { server = it; state.serverUrl = it },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Text(stringResource(R.string.server_hint), style = MaterialTheme.typography.bodySmall)
        }
    }
}
