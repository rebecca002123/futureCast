/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'StormWidget',
  displayName: 'Atlantic Storm Watch',
  icon: '../../assets/icon.png',
  // Lock Screen (accessory) widget families need iOS 16.
  deploymentTarget: '16.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  colors: {
    $accent: '#38bdf8',
    $widgetBackground: '#0e1420',
  },
  entitlements: {
    // Same App Group as the app, so the widget can read the snapshot the app
    // writes after every refresh (see src/widget.js).
    'com.apple.security.application-groups':
      config.ios?.entitlements?.['com.apple.security.application-groups'] ?? [
        'group.com.eclipselookout.app',
      ],
  },
});
