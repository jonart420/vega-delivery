package org.vegadelivery.app

import android.app.Application
import org.vegadelivery.app.data.AppState
import org.vegadelivery.app.sync.AppDatabase
import org.vegadelivery.app.sync.Outbox

/** Application singletons (small app – no DI framework). */
class VegaApp : Application() {
    companion object {
        lateinit var state: AppState
            private set
        lateinit var outbox: Outbox
            private set
    }

    override fun onCreate() {
        super.onCreate()
        state = AppState(this)
        outbox = Outbox(this, AppDatabase.create(this).events())
        outbox.schedule()
    }
}
