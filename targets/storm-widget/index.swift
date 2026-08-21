//  Atlantic Storm Watch — Home Screen and Lock Screen widgets.
//
//  The widget can't run the app's JavaScript, so it renders the snapshot the
//  app writes into the shared App Group after every refresh (see
//  src/widget.js). Timelines are reloaded by the app on each refresh —
//  including from the background task while the app is closed — and the
//  widget also asks for a reload every 30 minutes so the "updated" line stays
//  honest when the app hasn't run for a while.

import WidgetKit
import SwiftUI

let appGroup = "group.com.atlanticstormwatch.app"
let snapshotKey = "stormWatch"

// MARK: - Data

struct StormSnapshot: Codable {
    var updatedAt: Double?
    var stormCount: Int?
    var hurricaneCount: Int?
    var formingCount: Int?

    var band: String?
    var score: Int?
    var bandColor: String?
    var stormName: String?
    var stormKind: String?
    var stormWindMph: Int?

    var closestMiles: Int?
    var closestPlace: String?
    var closestDay: String?

    var gustMph: Int?
    var gustDay: String?
    var gustPlace: String?
    var stormyDayCount: Int?

    var warnLevel: String?
    var warnType: String?
    var warnColor: String?
    var namedStorm: String?
    var floodCount: Int?

    static let placeholder = StormSnapshot(
        updatedAt: Date().timeIntervalSince1970,
        stormCount: 2,
        hurricaneCount: 1,
        formingCount: 1,
        band: "Elevated",
        score: 61,
        bandColor: "#ea580c",
        stormName: "Fiona",
        stormKind: "Cat 2 hurricane",
        stormWindMph: 109,
        closestMiles: 37,
        closestPlace: "Outer Hebrides",
        closestDay: "Mon, 24 Aug",
        gustMph: 62,
        gustDay: "Mon, 24 Aug",
        gustPlace: "Stornoway",
        stormyDayCount: 2
    )

    static func load() -> StormSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let raw = defaults.string(forKey: snapshotKey),
              let data = raw.data(using: .utf8),
              let snapshot = try? JSONDecoder().decode(StormSnapshot.self, from: data)
        else { return nil }
        return snapshot
    }

    var updatedDate: Date? {
        guard let updatedAt else { return nil }
        return Date(timeIntervalSince1970: updatedAt)
    }

    var hasStorm: Bool {
        (stormCount ?? 0) > 0 && stormName != nil
    }

    // The one-line answer: is anything heading our way?
    var headline: String {
        guard hasStorm, let band else { return "No Atlantic storms" }
        if band == "None" { return "No Atlantic storms" }
        return "\(stormName ?? "Storm") · UK \(band)"
    }

    var detail: String {
        if hasStorm, let miles = closestMiles, let place = closestPlace {
            return "~\(miles) mi from \(place)"
        }
        if let count = stormCount, count > 0 {
            return "\(count) system\(count == 1 ? "" : "s"), none aimed at the UK"
        }
        if let forming = formingCount, forming > 0 {
            return "\(forming) area\(forming == 1 ? "" : "s") could still develop"
        }
        return "Nothing tropical to track"
    }

    var windLine: String? {
        guard let gust = gustMph, let day = gustDay else { return nil }
        return "UK gusts \(gust) mph · \(day)"
    }

    var warningLine: String? {
        guard let level = warnLevel, let type = warnType else { return nil }
        return "\(level) \(type.lowercased()) warning"
    }

    var tint: Color {
        Color(hex: bandColor ?? "#4b8f6f")
    }
}

extension Color {
    init(hex: String) {
        var value: UInt64 = 0
        let cleaned = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        Scanner(string: cleaned).scanHexInt64(&value)
        let r = Double((value & 0xFF0000) >> 16) / 255
        let g = Double((value & 0x00FF00) >> 8) / 255
        let b = Double(value & 0x0000FF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

// iOS 17 requires `containerBackground`; earlier versions need a plain
// background, so both paths are kept.
extension View {
    @ViewBuilder
    func widgetContainerBackground(_ background: Color) -> some View {
        if #available(iOS 17.0, *) {
            self.containerBackground(background, for: .widget)
        } else {
            self.background(background)
        }
    }
}

// MARK: - Timeline

struct StormEntry: TimelineEntry {
    let date: Date
    let snapshot: StormSnapshot
    let isPlaceholder: Bool
}

struct StormProvider: TimelineProvider {
    func placeholder(in context: Context) -> StormEntry {
        StormEntry(date: Date(), snapshot: .placeholder, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (StormEntry) -> Void) {
        let stored = StormSnapshot.load()
        completion(StormEntry(date: Date(), snapshot: stored ?? .placeholder, isPlaceholder: stored == nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StormEntry>) -> Void) {
        let stored = StormSnapshot.load()
        let entry = StormEntry(date: Date(), snapshot: stored ?? .placeholder, isPlaceholder: stored == nil)
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Views

struct UpdatedLine: View {
    let entry: StormEntry

    var body: some View {
        Group {
            if entry.isPlaceholder {
                Text("Open the app to load data")
            } else if let updated = entry.snapshot.updatedDate {
                Text("Updated \(updated, style: .relative) ago")
            } else {
                Text("Atlantic Storm Watch")
            }
        }
        .font(.system(size: 10))
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
}

struct RiskBadge: View {
    let snapshot: StormSnapshot

    var body: some View {
        Text(snapshot.hasStorm ? (snapshot.band ?? "—").uppercased() : "ALL CLEAR")
            .font(.system(size: 11, weight: .heavy))
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Capsule().fill(snapshot.tint))
    }
}

struct SmallStormView: View {
    let entry: StormEntry
    var s: StormSnapshot { entry.snapshot }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: "hurricane")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(s.tint)
                Text("UK RISK")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
            }
            Text(s.hasStorm ? (s.band ?? "—") : "Clear")
                .font(.system(size: 24, weight: .heavy))
                .foregroundStyle(s.tint)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            if s.hasStorm, let name = s.stormName {
                Text(name)
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
            }
            Text(s.detail)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(2)
            Spacer(minLength: 0)
            UpdatedLine(entry: entry)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(2)
        .widgetContainerBackground(Color(hex: "#0e1420"))
    }
}

struct MediumStormView: View {
    let entry: StormEntry
    var s: StormSnapshot { entry.snapshot }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                RiskBadge(snapshot: s)
                Text(s.hasStorm ? (s.stormName ?? "—") : "No storms")
                    .font(.system(size: 20, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if s.hasStorm, let kind = s.stormKind {
                    Text(s.stormWindMph.map { "\(kind) · \($0) mph" } ?? kind)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                UpdatedLine(entry: entry)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 7) {
                if s.hasStorm, let miles = s.closestMiles, let place = s.closestPlace {
                    StatRow(
                        icon: "arrow.triangle.turn.up.right.diamond",
                        title: "~\(miles) mi from \(place)",
                        subtitle: s.closestDay.map { "closest \($0)" }
                    )
                } else {
                    StatRow(
                        icon: "checkmark.seal",
                        title: s.detail,
                        subtitle: nil
                    )
                }
                if let gust = s.gustMph, let day = s.gustDay {
                    StatRow(
                        icon: "wind",
                        title: "UK gusts \(gust) mph",
                        subtitle: s.gustPlace.map { "\(day) · \($0)" } ?? day
                    )
                }
                if let warn = s.warningLine {
                    StatRow(
                        icon: "exclamationmark.triangle",
                        title: warn,
                        subtitle: s.namedStorm.map { "Storm \($0)" }
                    )
                } else if let forming = s.formingCount, forming > 0 {
                    StatRow(
                        icon: "eye",
                        title: "\(forming) area\(forming == 1 ? "" : "s") may develop",
                        subtitle: nil
                    )
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(2)
        .widgetContainerBackground(Color(hex: "#0e1420"))
    }
}

struct StatRow: View {
    let icon: String
    let title: String
    let subtitle: String?

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(2)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

struct StormWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: StormEntry

    var body: some View {
        switch family {
        case .systemMedium:
            MediumStormView(entry: entry)
        default:
            SmallStormView(entry: entry)
        }
    }
}

struct StormWidget: Widget {
    let kind = "StormWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StormProvider()) { entry in
            StormWidgetEntryView(entry: entry)
                .widgetURL(URL(string: "stormwatch://storms"))
        }
        .configurationDisplayName("Atlantic Storm Watch")
        .description("The highest UK risk from any active Atlantic storm.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Lock Screen

struct StormAccessoryView: View {
    @Environment(\.widgetFamily) var family
    let entry: StormEntry
    var s: StormSnapshot { entry.snapshot }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(s.hasStorm ? "\(s.stormName ?? "Storm") · UK \(s.band ?? "—")" : "No Atlantic storms")
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Image(systemName: "hurricane")
                        .font(.system(size: 12, weight: .bold))
                    Text(s.hasStorm ? "\(s.score ?? 0)" : "—")
                        .font(.system(size: 15, weight: .heavy))
                }
            }
            .widgetLabel(s.hasStorm ? "UK \(s.band ?? "")" : "clear")
        default:
            VStack(alignment: .leading, spacing: 2) {
                Text(s.headline)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(s.detail)
                    .font(.system(size: 12))
                    .lineLimit(1)
                if let wind = s.windLine {
                    Text(wind)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

struct StormAccessoryWidget: Widget {
    let kind = "StormAccessoryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: StormProvider()) { entry in
            StormAccessoryView(entry: entry)
                .widgetURL(URL(string: "stormwatch://storms"))
        }
        .configurationDisplayName("Storm risk (Lock Screen)")
        .description("UK risk from the most threatening Atlantic storm.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Bundle

@main
struct StormWidgetBundle: WidgetBundle {
    var body: some Widget {
        StormWidget()
        StormAccessoryWidget()
    }
}
