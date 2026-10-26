package org.vegadelivery.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.LocalShipping
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.vegadelivery.app.R
import org.vegadelivery.app.VegaApp
import org.vegadelivery.app.data.TourSummary
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToursScreen(onOpen: (String) -> Unit, onLoggedOut: () -> Unit) {
    val state = VegaApp.state
    val scope = rememberCoroutineScope()
    val tours by state.tours.collectAsState()
    val offline by state.offline.collectAsState()
    val error by state.error.collectAsState()
    val pending by VegaApp.outbox.pendingCount.collectAsState(initial = 0)
    val rejected by VegaApp.outbox.rejectedCount.collectAsState(initial = 0)
    val user by state.user.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }

    fun refresh() {
        refreshing = true
        scope.launch {
            state.refreshConfig()
            state.refreshTours()
            VegaApp.outbox.schedule()
            refreshing = false
        }
    }
    LaunchedEffect(Unit) { refresh() }

    val today = LocalDate.now().toString()
    val sections = listOf(
        R.string.running to tours.filter { it.isRunning },
        R.string.today to tours.filter { !it.isRunning && !it.isDone && it.date <= today },
        R.string.upcoming to tours.filter { !it.isRunning && !it.isDone && it.date > today },
        R.string.finished to tours.filter { it.isDone }.reversed(),
    ).filter { it.second.isNotEmpty() }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(stringResource(R.string.tours)) },
            actions = {
                IconButton(onClick = { confirmLogout = true }) {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = stringResource(R.string.sign_out))
                }
            },
        )
    }) { padding ->
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refresh() }, modifier = Modifier.padding(padding).fillMaxSize()) {
            LazyColumn(Modifier.fillMaxSize()) {
                user?.let { item { Text(stringResource(R.string.signed_in_as, it.name), Modifier.padding(16.dp, 8.dp), style = MaterialTheme.typography.bodySmall) } }
                if (offline) item { Text(stringResource(R.string.offline_list), Modifier.padding(16.dp, 4.dp), color = MaterialTheme.colorScheme.secondary) }
                if (pending > 0) item { Text(stringResource(R.string.pending_events, pending), Modifier.padding(16.dp, 4.dp), color = MaterialTheme.colorScheme.tertiary) }
                if (rejected > 0) item { Text(stringResource(R.string.rejected_events, rejected), Modifier.padding(16.dp, 4.dp), color = MaterialTheme.colorScheme.error) }
                error?.let { item { Text(it, Modifier.padding(16.dp, 4.dp), color = MaterialTheme.colorScheme.error) } }
                sections.forEach { (title, list) ->
                    item { Text(stringResource(title).uppercase(), Modifier.padding(16.dp, 16.dp, 16.dp, 4.dp), style = MaterialTheme.typography.labelMedium) }
                    items(list, key = { it.id }) { tour ->
                        TourRow(tour) { onOpen(tour.id) }
                        HorizontalDivider()
                    }
                }
                if (tours.isEmpty() && !refreshing) item { Text(stringResource(R.string.no_tours), Modifier.padding(24.dp)) }
            }
        }
    }

    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text(stringResource(R.string.sign_out)) },
            text = { Text(stringResource(R.string.unsent_lost)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch {
                        state.logout()
                        onLoggedOut()
                    }
                }) { Text(stringResource(R.string.sign_out)) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun TourRow(tour: TourSummary, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Filled.LocalShipping, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f)) {
            Text(tour.title, style = MaterialTheme.typography.titleMedium)
            Text(
                listOfNotNull(Format.date(tour.date), tour.plannedStart, stringResource(R.string.stops_done, tour.completedCount, tour.stopCount),
                    tour.distanceKm?.let { Format.distance(it) }).joinToString("  ·  "),
                style = MaterialTheme.typography.bodySmall,
            )
        }
        if (tour.isDone) Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
    }
}
