package io.github.amaankhan63.afk.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory

/**
 * [create]'s view model, held in this store as a screen's back stack entry holds it: clearing the
 * store clears the view model, as leaving the screen for good does.
 */
inline fun <reified VM : ViewModel> ViewModelStore.holding(crossinline create: () -> VM): VM =
    ViewModelProvider(this, viewModelFactory { initializer { create() } })[VM::class.java]
