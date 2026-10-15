// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Adds a Night Light intensity slider to Quick Settings, directly below the
 * brightness slider. The slider writes
 * org.gnome.settings-daemon.plugins.color night-light-temperature; right means
 * warmer (more intense). Clicking the icon toggles night-light-enabled.
 *
 * The temperature only shows on screen while Night Light is active (enabled
 * and inside its schedule), the same as in GNOME Settings.
 */

import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickSlider, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

// System schema provided by gnome-settings-daemon. The extension ships no
// schema of its own, so there is no schemas/ directory in the ZIP.
const COLOR_SCHEMA = 'org.gnome.settings-daemon.plugins.color';
const ENABLED_KEY = 'night-light-enabled';
const TEMPERATURE_KEY = 'night-light-temperature';

// Kelvin at slider 100 % and 0 %. 6500 K is a neutral display (no tint);
// GNOME Settings' own scale bottoms out at 1700 K.
const WARMEST = 1700;
const COOLEST = 6500;
const STEP = 10;

function lookupColorSchema() {
    return Gio.SettingsSchemaSource.get_default().lookup(COLOR_SCHEMA, true);
}

function temperatureToValue(kelvin) {
    const clamped = Math.min(Math.max(kelvin, WARMEST), COOLEST);
    return (COOLEST - clamped) / (COOLEST - WARMEST);
}

function valueToTemperature(value) {
    const kelvin = COOLEST - value * (COOLEST - WARMEST);
    return Math.round(kelvin / STEP) * STEP;
}

const NightLightSlider = GObject.registerClass(
class NightLightSlider extends QuickSlider {
    _init() {
        super._init({
            iconName: 'night-light-symbolic',
            iconReactive: true,
            iconLabel: 'Toggle Night Light',
        });

        this.slider.accessible_name = 'Night Light Intensity';

        const monitorManager = global.backend.get_monitor_manager();
        monitorManager.bind_property('night-light-supported',
            this, 'visible',
            GObject.BindingFlags.SYNC_CREATE);

        this._settings = Gio.Settings.new_full(lookupColorSchema(), null, null);
        this._settings.connectObject(
            `changed::${TEMPERATURE_KEY}`, () => this._syncValue(),
            `changed::${ENABLED_KEY}`, () => this._syncEnabled(),
            this);

        this.slider.connectObject('notify::value', () => this._onSliderChanged(), this);
        this.connect('icon-clicked', () => {
            this._settings.set_boolean(ENABLED_KEY,
                !this._settings.get_boolean(ENABLED_KEY));
        });

        this._syncValue();
        this._syncEnabled();
    }

    destroy() {
        // QuickSlider always creates a (here unused) menu that lives in the
        // Quick Settings overlay, not under this actor.
        this.menu.destroy();
        super.destroy();
        this._settings = null;
    }

    _onSliderChanged() {
        if (this._blockSliderChanged)
            return;
        const kelvin = valueToTemperature(this.slider.value);
        if (kelvin !== this._settings.get_uint(TEMPERATURE_KEY))
            this._settings.set_uint(TEMPERATURE_KEY, kelvin);
    }

    _syncValue() {
        this._blockSliderChanged = true;
        this.slider.value = temperatureToValue(this._settings.get_uint(TEMPERATURE_KEY));
        this._blockSliderChanged = false;
    }

    _syncEnabled() {
        // Keep the slider usable while off, but show that it has no effect.
        this.slider.opacity = this._settings.get_boolean(ENABLED_KEY) ? 255 : 128;
    }
});

const Indicator = GObject.registerClass(
class Indicator extends SystemIndicator {
    _init() {
        super._init();
        this.quickSettingsItems.push(new NightLightSlider());
    }

    destroy() {
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class NightLightSliderExtension extends Extension {
    enable() {
        if (!lookupColorSchema()) {
            console.error(`${this.metadata.name}: schema ${COLOR_SCHEMA} not found; ` +
                'gnome-settings-daemon is required');
            return;
        }
        this._addWhenReady();
    }

    disable() {
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
    }

    // Quick Settings builds its built-in indicators asynchronously at startup.
    _addWhenReady() {
        const quickSettings = Main.panel.statusArea.quickSettings;
        if (!quickSettings._brightness) {
            this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._retryId = 0;
                this._addWhenReady();
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        this._indicator = new Indicator();
        quickSettings._indicators.add_child(this._indicator);

        // Full-width row directly below the brightness slider.
        const brightnessItem = quickSettings._brightness.quickSettingsItems.at(-1);
        const sibling = brightnessItem.get_next_sibling();
        const columns = quickSettings.menu._grid.layout_manager.nColumns ?? 2;
        for (const item of this._indicator.quickSettingsItems)
            quickSettings.menu.insertItemBefore(item, sibling, columns);
    }
}
