import ExpoModulesCore
import WidgetKit

// Bridge between the app's JS and the home-screen widget: JS sends a JSON
// snapshot of the lockbox, we park it in the shared app-group defaults and
// poke WidgetKit to redraw.
public class ExpoWidgetsModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoWidgets")

        Function("setWidgetData") { (data: String) -> Void in
            let widgetSuite = UserDefaults(suiteName: "group.com.eclipselookout.app.expowidgets")
            widgetSuite?.set(data, forKey: "LockboxData")

            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
        }
    }
}
