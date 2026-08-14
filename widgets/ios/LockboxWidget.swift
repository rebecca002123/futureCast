import WidgetKit
import SwiftUI

// The JSON snapshot the app writes via ExpoWidgetsModule.setWidgetData.
struct LockboxPayload: Codable {
    var balanceMinor: Int
    var symbol: String
    var open: Bool
    var unlockISO: String     // next unlock day, "yyyy-MM-dd" (local)
    var closesISO: String     // last spending day, "yyyy-MM-dd" (local)
    var projectedMinor: Int
    var goalMinor: Int?
}

struct LockboxEntry: TimelineEntry {
    let date: Date
    let payload: LockboxPayload?
}

private func loadPayload() -> LockboxPayload? {
    let suite = UserDefaults(suiteName: "group.com.christmaslockbox.app.expowidgets")
    guard let raw = suite?.string(forKey: "LockboxData"),
          let data = raw.data(using: .utf8) else {
        return nil
    }
    return try? JSONDecoder().decode(LockboxPayload.self, from: data)
}

private func parseLocalDay(_ iso: String) -> Date? {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.locale = Locale(identifier: "en_US_POSIX")
    return formatter.date(from: iso)
}

private func formatMoney(_ minor: Int, _ symbol: String) -> String {
    let units = abs(minor) / 100
    let cents = abs(minor) % 100
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    let grouped = formatter.string(from: NSNumber(value: units)) ?? String(units)
    let sign = minor < 0 ? "-" : ""
    if cents == 0 {
        return "\(sign)\(symbol)\(grouped)"
    }
    return String(format: "%@%@%@.%02d", sign, symbol, grouped, cents)
}

private func daysUntil(_ target: Date, from now: Date) -> Int {
    let cal = Calendar.current
    let start = cal.startOfDay(for: now)
    let end = cal.startOfDay(for: target)
    let days = cal.dateComponents([.day], from: start, to: end).day ?? 0
    return max(0, days)
}

struct LockboxProvider: TimelineProvider {
    func placeholder(in context: Context) -> LockboxEntry {
        LockboxEntry(date: Date(), payload: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (LockboxEntry) -> Void) {
        completion(LockboxEntry(date: Date(), payload: loadPayload()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<LockboxEntry>) -> Void) {
        let payload = loadPayload()
        let cal = Calendar.current
        let now = Date()
        var entries: [LockboxEntry] = [LockboxEntry(date: now, payload: payload)]
        // One entry per midnight so the countdown ticks over without the app.
        for offset in 1...14 {
            if let day = cal.date(byAdding: .day, value: offset, to: cal.startOfDay(for: now)) {
                entries.append(LockboxEntry(date: day, payload: payload))
            }
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct LockboxWidgetView: View {
    var entry: LockboxEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        content
            .containerBackground(for: .widget) {
                Color(red: 0.04, green: 0.09, blue: 0.07)
            }
    }

    @ViewBuilder
    private var content: some View {
        if let p = entry.payload {
            if p.open {
                openView(p)
            } else {
                lockedView(p)
            }
        } else {
            emptyView
        }
    }

    private var emptyView: some View {
        VStack(spacing: 4) {
            Text("🎄🔒")
            Text("Open the app to start your lockbox")
                .font(.caption2)
                .foregroundColor(.white.opacity(0.7))
                .multilineTextAlignment(.center)
        }
    }

    private func lockedView(_ p: LockboxPayload) -> some View {
        let unlockDate = parseLocalDay(p.unlockISO)
        let days = unlockDate.map { daysUntil($0, from: entry.date) } ?? 0
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text("🔒")
                Spacer()
                Text("🎄")
            }
            .font(.system(size: 14))
            Spacer(minLength: 0)
            Text(formatMoney(p.balanceMinor, p.symbol))
                .font(.system(size: family == .systemSmall ? 22 : 26, weight: .heavy))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(days == 0 ? "Unlocks today!" : "\(days) day\(days == 1 ? "" : "s") to unlock")
                .font(.caption)
                .foregroundColor(Color(red: 0.96, green: 0.77, blue: 0.32))
            if family != .systemSmall, let goal = p.goalMinor, goal > 0 {
                ProgressView(value: min(1.0, Double(p.projectedMinor) / Double(goal)))
                    .tint(Color(red: 0.96, green: 0.77, blue: 0.32))
                Text("Heading for \(formatMoney(p.projectedMinor, p.symbol)) of \(formatMoney(goal, p.symbol))")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.6))
            }
        }
    }

    private func openView(_ p: LockboxPayload) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("🎁")
                .font(.system(size: 16))
            Spacer(minLength: 0)
            Text(formatMoney(p.balanceMinor, p.symbol))
                .font(.system(size: family == .systemSmall ? 22 : 26, weight: .heavy))
                .foregroundColor(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text("OPEN — go spend!")
                .font(.caption.weight(.bold))
                .foregroundColor(Color(red: 0.49, green: 0.91, blue: 0.53))
            if family != .systemSmall {
                Text("Spend by \(p.closesISO)")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.6))
            }
        }
    }
}

struct LockboxWidget: Widget {
    let kind: String = "LockboxWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LockboxProvider()) { entry in
            LockboxWidgetView(entry: entry)
        }
        .configurationDisplayName("Christmas Lockbox")
        .description("Your locked savings and the countdown to unlock day.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
