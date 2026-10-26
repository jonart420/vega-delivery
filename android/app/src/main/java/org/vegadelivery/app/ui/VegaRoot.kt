package org.vegadelivery.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.MutableStateFlow
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.LoginQR
import org.vegadelivery.app.data.parseHexColor

/** Theme (brand colour from the server) and navigation between the screens. */
@Composable
fun VegaRoot(pendingLogin: MutableStateFlow<LoginQR?>) {
    val state = VegaApp.state
    val user by state.user.collectAsState()
    val config by state.config.collectAsState()
    val qr by pendingLogin.collectAsState()
    val brand = Color(parseHexColor(config?.brand?.color) ?: 0xFF2563EB)
    val scheme = if (isSystemInDarkTheme()) darkColorScheme(primary = brand) else lightColorScheme(primary = brand)

    LaunchedEffect(qr) {
        qr?.let {
            pendingLogin.value = null
            state.login(it)
        }
    }

    MaterialTheme(colorScheme = scheme) {
        val nav = rememberNavController()
        val loggedIn = user != null && state.isLoggedIn
        NavHost(navController = nav, startDestination = if (loggedIn) "tours" else "login") {
            composable("login") {
                LoginScreen(onLoggedIn = { nav.navigate("tours") { popUpTo("login") { inclusive = true } } })
            }
            composable("tours") {
                ToursScreen(
                    onOpen = { nav.navigate("tour/$it") },
                    onLoggedOut = { nav.navigate("login") { popUpTo("tours") { inclusive = true } } },
                )
            }
            composable("tour/{id}") { entry ->
                val id = entry.arguments?.getString("id") ?: return@composable
                TourDetailScreen(tourId = id, onBack = { nav.popBackStack() }, onNavigate = { nav.navigate("nav/$id") })
            }
            composable("nav/{id}") { entry ->
                val id = entry.arguments?.getString("id") ?: return@composable
                NavigationScreen(tourId = id, onBack = { nav.popBackStack() })
            }
        }
        LaunchedEffect(loggedIn) {
            if (!loggedIn && nav.currentDestination?.route != "login") {
                nav.navigate("login") { popUpTo(0) }
            }
        }
    }
}
