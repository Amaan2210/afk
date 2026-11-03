package io.github.amaankhan63.afk.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import io.github.amaankhan63.afk.ui.pairing.PairingScreen
import io.github.amaankhan63.afk.ui.session.SessionScreen
import io.github.amaankhan63.afk.ui.sessions.SessionsScreen
import io.github.amaankhan63.afk.ui.subagent.SubagentScreen

/**
 * The app's screens, from [startDestination]: [Routes.PAIRING] while the app is not paired, else
 * [Routes.SESSIONS].
 *
 * [deepLink] is a route a notification asked for (see [Routes.parseDeepLink]), and
 * [onDeepLinkConsumed] clears it so it is handled once; [deepLinkAction] decides what it does.
 *
 * Every forward step is single-top, so a second tap during a transition does not open the screen
 * twice. Single-top matches the destination, not its arguments: a session or thread opened from
 * the same kind of screen takes that screen's place, and [key] gives it its own state.
 */
@Composable
fun AfkNavHost(
    startDestination: String,
    deepLink: String? = null,
    onDeepLinkConsumed: () -> Unit = {},
    navController: NavHostController = rememberNavController()
) {
    NavHost(navController, startDestination) {
        composable(Routes.PAIRING) {
            PairingScreen(
                onPaired = {
                    navController.navigate(Routes.SESSIONS) {
                        popUpTo(Routes.PAIRING) { inclusive = true }
                        launchSingleTop = true
                    }
                }
            )
        }
        composable(Routes.SESSIONS) {
            SessionsScreen(
                onOpen = { navController.forward(Routes.session(it)) },
                onNew = { navController.forward(Routes.NEW) },
                onSettings = { navController.forward(Routes.SETTINGS) }
            )
        }
        // Tasks 13 and 14 replace these two.
        composable(Routes.NEW) {
            PlaceholderScreen("New session", onBack = navController.back())
        }
        composable(Routes.SETTINGS) {
            PlaceholderScreen("Settings", onBack = navController.back())
        }
        composable(Routes.SESSION, arguments = listOf(stringArgument(Routes.ARG_ID))) { entry ->
            val id = entry.argument(Routes.ARG_ID)
            key(id) {
                SessionScreen(
                    sessionId = id,
                    onBack = navController.back(),
                    onOpenThread = { navController.forward(Routes.thread(id, it)) },
                    // The resumed session takes the ended one's place.
                    onOpenSession = {
                        navController.navigate(Routes.session(it)) { popUpTo(Routes.SESSIONS) }
                    }
                )
            }
        }
        composable(
            Routes.THREAD,
            arguments = listOf(stringArgument(Routes.ARG_ID), stringArgument(Routes.ARG_THREAD_ID))
        ) { entry ->
            val id = entry.argument(Routes.ARG_ID)
            val threadId = entry.argument(Routes.ARG_THREAD_ID)
            key(id, threadId) {
                SubagentScreen(
                    sessionId = id,
                    threadId = threadId,
                    onBack = navController.back(),
                    onOpenThread = { navController.forward(Routes.thread(id, it)) }
                )
            }
        }
    }

    // After the NavHost, so its graph is set. Cleared first: the link is handled once at most.
    LaunchedEffect(deepLink) {
        val route = deepLink ?: return@LaunchedEffect
        onDeepLinkConsumed()
        val top = navController.currentBackStackEntry
        val topId = top?.arguments?.getString(Routes.ARG_ID)
        when (deepLinkAction(top?.destination?.route, topId, route)) {
            DeepLinkAction.Ignore -> Unit

            DeepLinkAction.PopTo ->
                if (!navController.popBackStack(route, inclusive = false)) navController.open(route)

            DeepLinkAction.Navigate -> navController.open(route)
        }
    }
}

/** Opens [route] over the screen in front, single-top (see [AfkNavHost]). */
private fun NavHostController.forward(route: String) = navigate(route) { launchSingleTop = true }

/** Opens session [route] over the session list, from a link. */
private fun NavHostController.open(route: String) = navigate(route) {
    popUpTo(Routes.SESSIONS)
    launchSingleTop = true
}

/**
 * Goes back one screen. Only while the screen is resumed: a second tap during the transition would
 * pop the screen under it too.
 */
@Composable
private fun NavHostController.back(): () -> Unit = dropUnlessResumed { popBackStack() }

private fun stringArgument(name: String) = navArgument(name) { type = NavType.StringType }

private fun NavBackStackEntry.argument(name: String): String =
    checkNotNull(arguments?.getString(name)) { "The route ${destination.route} has no $name" }
