package org.vegadelivery.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import kotlinx.coroutines.flow.MutableStateFlow
import org.vegadelivery.app.data.LoginCode
import org.vegadelivery.app.data.LoginQR
import org.vegadelivery.app.ui.VegaRoot

class MainActivity : ComponentActivity() {
    /** Login QR opened via the system camera (vegadelivery://login?…) */
    private val pendingLogin = MutableStateFlow<LoginQR?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingLogin.value = LoginCode.fromUri(intent?.data)
        setContent { VegaRoot(pendingLogin) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        LoginCode.fromUri(intent.data)?.let { pendingLogin.value = it }
    }

    override fun onResume() {
        super.onResume()
        VegaApp.outbox.schedule()
    }
}
