package org.vegadelivery.app.ui

import android.Manifest
import android.app.Application
import android.location.Location
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.stadiamaps.ferrostar.core.DefaultNavigationViewModel
import com.stadiamaps.ferrostar.core.FerrostarCore
import com.stadiamaps.ferrostar.core.AndroidTtsObserver
import com.stadiamaps.ferrostar.core.http.OkHttpClientProvider
import com.stadiamaps.ferrostar.core.location.AndroidLocationProvider
import com.stadiamaps.ferrostar.core.location.toUserLocation
import com.stadiamaps.ferrostar.core.withJsonOptions
import com.stadiamaps.ferrostar.maplibreui.views.DynamicallyOrientingNavigationView
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.maplibre.compose.style.BaseStyle
import org.vegadelivery.app.R
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.DeliveryOutcome
import org.vegadelivery.app.data.TourPackage
import org.vegadelivery.app.data.TourStop
import org.vegadelivery.app.sync.StopState
import uniffi.ferrostar.CourseFiltering
import uniffi.ferrostar.GeographicCoordinate
import uniffi.ferrostar.NavigationControllerConfig
import uniffi.ferrostar.RouteDeviationTracking
import uniffi.ferrostar.Waypoint
import uniffi.ferrostar.WaypointAdvanceMode
import uniffi.ferrostar.WaypointKind
import uniffi.ferrostar.WellKnownRouteProvider
import uniffi.ferrostar.stepAdvanceDistanceEntryAndExit
import uniffi.ferrostar.stepAdvanceDistanceToEndOfStep
import java.util.Locale

/**
 * Turn-by-turn navigation by car to the next open stop (Ferrostar + MapLibre, Valhalla through the
 * server's routing proxy). Arrival by geofence (50 m) or "I'm here" opens the stop sheet.
 */
class TourNavigationViewModel(app: Application) : AndroidViewModel(app) {
    companion object {
        const val ARRIVAL_RADIUS_M = 50f
    }

    sealed class Phase {
        data object Idle : Phase()
        data object Loading : Phase()
        data object Navigating : Phase()
        data class Arrived(val stopId: String) : Phase()
        data object Finished : Phase()
    }

    val phase = MutableStateFlow<Phase>(Phase.Idle)
    val message = MutableStateFlow<String?>(null)
    val order = MutableStateFlow<List<String>>(emptyList())
    val handled = MutableStateFlow<Set<String>>(emptySet())

    var pkg: TourPackage? = null
        private set
    private var core: FerrostarCore? = null
    var navViewModel: DefaultNavigationViewModel? = null
        private set
    private val locationProvider = AndroidLocationProvider(app)
    private var lastLocation: Location? = null
    private var locationJob: Job? = null
    private var tts: AndroidTtsObserver? = null
    private var suppressedArrival: String? = null

    fun setUp(pkg: TourPackage, completed: Set<String>) {
        if (this.pkg?.tour?.id == pkg.tour.id) return
        this.pkg = pkg
        order.value = pkg.stops.filter { it.hasCoordinate }.map { it.id }
        handled.value = completed
        val state = VegaApp.state
        val base = state.api()?.baseUrl ?: return
        val token = state.deviceToken
        val http = ApiClientHttp.withToken(token)
        val language = if (Locale.getDefault().language == "de") "de-DE" else "en-US"
        val provider = WellKnownRouteProvider.Valhalla("${base.trimEnd('/')}/api/app/valhalla/route", pkg.tour.mode)
            .withJsonOptions(mapOf("directions_options" to mapOf("language" to language, "units" to "kilometers")))
        val c = FerrostarCore(
            wellKnownRouteProvider = provider,
            httpClient = OkHttpClientProvider(http),
            locationProvider = locationProvider,
            navigationControllerConfig = NavigationControllerConfig(
                waypointAdvance = WaypointAdvanceMode.WaypointWithinRange(ARRIVAL_RADIUS_M.toDouble()),
                stepAdvanceCondition = stepAdvanceDistanceEntryAndExit(40u, 10u, 40u),
                arrivalStepAdvanceCondition = stepAdvanceDistanceToEndOfStep(25u, 40u),
                routeDeviationTracking = RouteDeviationTracking.StaticThreshold(30u, 50.0),
                snappedLocationCourseFiltering = CourseFiltering.SNAP_TO_ROUTE,
            ),
        )
        tts = AndroidTtsObserver(getApplication()).also {
            it.start()
            c.spokenInstructionObserver = it
        }
        core = c
        navViewModel = DefaultNavigationViewModel(c)
        locationJob = viewModelScope.launch {
            try {
                locationProvider.locationUpdates(1000).collect { onLocation(it) }
            } catch (_: SecurityException) {
                message.value = getApplication<Application>().getString(R.string.location_needed)
            }
        }
    }

    val nextStop: TourStop?
        get() = order.value.firstOrNull { it !in handled.value }?.let { id -> pkg?.stops?.firstOrNull { it.id == id } }

    fun navigateToNext() {
        val c = core ?: return
        val stop = nextStop ?: run {
            phase.value = Phase.Finished
            return
        }
        val here = lastLocation ?: run {
            message.value = getApplication<Application>().getString(R.string.no_location)
            return
        }
        phase.value = Phase.Loading
        message.value = null
        viewModelScope.launch {
            try {
                val routes = c.getRoutes(
                    here.toUserLocation(),
                    listOf(Waypoint(coordinate = GeographicCoordinate(stop.lat!!, stop.lon!!), kind = WaypointKind.BREAK, properties = null)),
                )
                val route = routes.firstOrNull() ?: throw IllegalStateException("No route")
                navViewModel?.setDestination(stop.name)
                c.startNavigation(route)
            } catch (_: Exception) {
                // Offline or Valhalla unreachable: arrival still works by GPS
                message.value = getApplication<Application>().getString(R.string.offline_gps)
            }
            phase.value = Phase.Navigating
        }
    }

    private fun onLocation(location: Location) {
        lastLocation = location
        val stop = nextStop ?: return
        if (phase.value != Phase.Navigating || stop.lat == null || stop.lon == null) return
        val result = FloatArray(1)
        Location.distanceBetween(location.latitude, location.longitude, stop.lat, stop.lon, result)
        if (suppressedArrival == stop.id) {
            if (result[0] > ARRIVAL_RADIUS_M * 2) suppressedArrival = null
            return
        }
        if (result[0] <= ARRIVAL_RADIUS_M) arrive(stop)
    }

    fun arriveManually() {
        nextStop?.let { arrive(it) }
    }

    private fun arrive(stop: TourStop) {
        core?.stopNavigation()
        phase.value = Phase.Arrived(stop.id)
    }

    /** Arrival sheet closed without completing outcome: keep the stop, continue later */
    fun dismissArrival() {
        val p = phase.value
        if (p is Phase.Arrived) suppressedArrival = p.stopId
        phase.value = Phase.Idle
    }

    fun markHandled(stopId: String) {
        handled.value = handled.value + stopId
        phase.value = if (nextStop == null) Phase.Finished else Phase.Idle
    }

    fun postponeNext() {
        val stop = nextStop ?: return
        core?.stopNavigation()
        order.value = order.value.filter { it != stop.id } + stop.id
        phase.value = Phase.Idle
    }

    override fun onCleared() {
        locationJob?.cancel()
        core?.stopNavigation()
        tts?.shutdown()
        super.onCleared()
    }
}

/** OkHttp client for Ferrostar's routing requests that adds the device token. */
object ApiClientHttp {
    fun withToken(token: String?): okhttp3.OkHttpClient = org.vegadelivery.app.data.ApiClient.http.newBuilder()
        .addInterceptor { chain ->
            val req = chain.request().newBuilder().apply { token?.let { header("Authorization", "Bearer $it") } }.build()
            chain.proceed(req)
        }
        .build()
}

@Composable
fun NavigationScreen(tourId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val vm: TourNavigationViewModel = viewModel()
    val config by VegaApp.state.config.collectAsState()
    val events by VegaApp.outbox.eventsFor(tourId).collectAsState(initial = emptyList())
    val phase by vm.phase.collectAsState()
    val message by vm.message.collectAsState()
    vm.order.collectAsState().value // recompose on order changes
    val handled by vm.handled.collectAsState()
    var hasLocation by remember { mutableStateOf(context.hasPermission(Manifest.permission.ACCESS_FINE_LOCATION)) }
    val permissions = rememberPermissionsRequest { hasLocation = it }

    val pkg = remember(tourId) { VegaApp.state.cachedPackage(tourId) }
    if (pkg == null) {
        onBack()
        return
    }
    LaunchedEffect(Unit) { if (!hasLocation) permissions.launch(trackingPermissions) }
    LaunchedEffect(hasLocation) {
        if (hasLocation) vm.setUp(pkg, StopState.compute(pkg, events).filterValues { it.isCompleted }.keys)
    }
    DisposableEffect(Unit) { onDispose { } }

    if (!hasLocation) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stringResource(R.string.location_needed))
            Button(onClick = { permissions.launch(trackingPermissions) }) { Text(stringResource(R.string.allow)) }
            TextButton(onClick = onBack) { Text(stringResource(R.string.back_to_tour)) }
        }
        return
    }

    Box(Modifier.fillMaxSize()) {
        vm.navViewModel?.let { navVm ->
            DynamicallyOrientingNavigationView(
                modifier = Modifier.fillMaxSize(),
                baseStyle = BaseStyle.Uri(config?.map?.styleUrl ?: "https://tiles.openfreemap.org/styles/liberty"),
                viewModel = navVm,
                onTapExit = { navVm.stopNavigation() },
            )
        }

        val next = vm.nextStop
        val navigating = vm.navViewModel?.navigationUiState?.collectAsState()?.value?.isNavigating() == true
        if (!navigating) {
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(12.dp)
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(20.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary) }
                if (next != null) {
                    Row {
                        Text(stringResource(R.string.next_stop), Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                        Text(stringResource(R.string.open_count, vm.order.value.count { it !in handled }), style = MaterialTheme.typography.labelMedium)
                    }
                    Text(next.name, style = MaterialTheme.typography.titleLarge)
                    Text(next.addressLine)
                    next.deliveryNotes?.let { Text(it, color = MaterialTheme.colorScheme.tertiary) }
                    Button(onClick = { vm.navigateToNext() }, enabled = phase != TourNavigationViewModel.Phase.Loading, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(if (phase == TourNavigationViewModel.Phase.Loading) R.string.calculating else R.string.drive))
                    }
                    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                        TextButton(onClick = { vm.arriveManually() }) { Text(stringResource(R.string.im_here)) }
                        TextButton(onClick = { vm.postponeNext() }) { Text(stringResource(R.string.later)) }
                        TextButton(onClick = onBack) { Text(stringResource(R.string.back_to_tour)) }
                    }
                } else {
                    Text(stringResource(R.string.all_done), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                    Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.back_to_tour)) }
                }
            }
        } else {
            Row(Modifier.align(Alignment.BottomStart).safeDrawingPadding().padding(16.dp, 110.dp)) {
                Button(onClick = { vm.arriveManually() }) { Text(stringResource(R.string.im_here)) }
            }
        }
    }

    (phase as? TourNavigationViewModel.Phase.Arrived)?.let { arrived ->
        val stop = pkg.stops.firstOrNull { it.id == arrived.stopId } ?: return@let
        StopSheet(pkg, stop, StopState.Arrived, canRecord = pkg.tour.status == "in_progress") { outcome: DeliveryOutcome? ->
            if (outcome != null && outcome.completesStop) {
                vm.markHandled(stop.id)
                vm.navigateToNext()
            } else {
                vm.dismissArrival()
            }
        }
    }
}
