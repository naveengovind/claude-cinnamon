// Claude in your browser: Cinnamon's themes and extensions on claude.ai too, through a small extension that the
// `cinnamon browser` command sets up for each browser. Lists the browsers on this Mac (`cinnamon browser list --json`)
// with whether each one's extension is really added and connected, and walks the person through adding it.
import AppKit
import SwiftUI

/** The browser part, as a section: in the Setup window and in its own window ("Use in a Browser…"). */
struct BrowserSection: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Claude in your browser").font(.headline)
        Text("Use the same color schemes and extensions on claude.ai in your browser. Optional: the desktop app works without it.")
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      if let list = model.browsers {
        if list.installed.isEmpty {
          Text("None of the browsers Cinnamon works with is on this Mac: Google Chrome, Arc, Brave, Microsoft Edge, Chromium or Vivaldi.")
            .font(.callout)
            .fixedSize(horizontal: false, vertical: true)
        } else {
          VStack(spacing: 0) {
            ForEach(Array(list.installed.enumerated()), id: \.element.id) { i, b in
              if i > 0 { Divider() }
              BrowserRow(browser: b)
            }
          }
          .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
        }
        if !list.missing.isEmpty {
          Text("Also works with \(list.missing.map(\.name).joined(separator: ", ")) (not on this Mac).")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      } else if model.cliMissing {
        Text("Set up Cinnamon first.").font(.callout).foregroundStyle(.secondary)
      } else {
        ProgressView().controlSize(.small)
      }

      if let steps = model.browserSteps { BrowserStepsView(steps: steps) }
    }
    .task { await model.refreshBrowsers() }
  }
}

private struct BrowserRow: View {
  @EnvironmentObject var model: AppModel
  let browser: BrowserList.Browser

  private var statusText: String {
    guard browser.registered else { return "Not set up" }
    switch browser.link {
    case "connected": return "Connected"
    case "idle": return "Added · connects while claude.ai is open"
    default: return "Extension not added yet"
    }
  }

  private var statusColor: Color {
    guard browser.registered else { return .secondary }
    return browser.link == "connected" || browser.link == "idle" ? .green : .orange
  }

  var body: some View {
    HStack(spacing: 10) {
      BrowserIcon(name: browser.name)
      VStack(alignment: .leading, spacing: 2) {
        Text(browser.name)
        Text(statusText)
          .font(.caption)
          .foregroundStyle(statusColor)
      }
      Spacer()
      if browser.registered {
        if browser.link == "never" || browser.link == nil {
          Button("Finish Adding") { model.browserSteps = BrowserSteps(browser: browser, folder: model.browsers?.extensionDir ?? "", openedPage: false) }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        } else {
          Button("Show Steps") { model.browserSteps = BrowserSteps(browser: browser, folder: model.browsers?.extensionDir ?? "", openedPage: false) }
            .controlSize(.small)
        }
        Button("Remove") { Task { await model.removeBrowser(browser) } }
          .controlSize(.small)
      } else {
        Button("Set Up") { Task { await model.installBrowser(browser) } }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
      }
    }
    .padding(10)
    .disabled(model.busy != nil)
  }
}

/** The browser's own icon when it can be found by name, else a globe. */
private struct BrowserIcon: View {
  let name: String

  var body: some View {
    if let icon = Self.icon(for: name) {
      Image(nsImage: icon).resizable().frame(width: 22, height: 22)
    } else {
      Image(systemName: "globe").frame(width: 22, height: 22)
    }
  }

  static func icon(for name: String) -> NSImage? {
    // Brave's app is "Brave Browser"; the rest are named as listed
    for app in [name, "\(name) Browser"] {
      for dir in ["/Applications", "\(CLI.home)/Applications"] {
        let path = "\(dir)/\(app).app"
        if FileManager.default.fileExists(atPath: path) { return NSWorkspace.shared.icon(forFile: path) }
      }
    }
    return nil
  }
}

/**
 * The walkthrough for adding the extension to one browser: why it looks unusual and what the extension can do, then
 * the steps, each with a button, ending on a live check that the browser has connected.
 */
struct BrowserStepsView: View {
  @EnvironmentObject var model: AppModel
  let steps: BrowserSteps
  @State private var openedPage = false
  @State private var showedFolder = false
  @State private var whyOpen = true
  @State private var poll: Timer?

  /** The browser as `browser list --json` says now (its link changes while this is open). */
  private var current: BrowserList.Browser {
    model.browsers?.browsers.first { $0.id == steps.browser.id } ?? steps.browser
  }
  private var connected: Bool { current.link == "connected" || current.link == "idle" }
  private var name: String { steps.browser.name }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack {
        Text("Add Cinnamon to \(name)").font(.headline)
        Spacer()
        Button { model.browserSteps = nil } label: { Image(systemName: "xmark") }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .help("Close")
      }

      DisclosureGroup(isExpanded: $whyOpen) {
        VStack(alignment: .leading, spacing: 6) {
          bullet("Browsers take extensions from their store, or ones you add yourself with **Developer mode** on. Cinnamon isn't in a store, so you add it yourself, once. Developer mode only shows the button for that; it changes nothing else.")
          bullet("The extension runs **only on claude.ai**. It can't see other sites, your tabs or your history.")
          bullet("It talks **only to Cinnamon on this Mac**, to get your themes and extensions. It sends nothing anywhere else.")
          bullet("Its code is the folder you add, built on this Mac by Cinnamon. Nothing is downloaded.")
          bullet("\(name) may mention extensions in developer mode now and then. That's expected. You can remove Cinnamon any time from the extensions page, or with Remove here.")
        }
        .padding(.top, 4)
      } label: {
        Text("Why this looks unusual, and what the extension can do").font(.callout.weight(.medium))
      }

      step(1, done: openedPage, "Open \(name)'s extensions page.") {
        Button(openedPage ? "Open Again" : "Open Extensions Page") {
          openedPage = true
          Task { await model.openExtensionsPage(steps.browser) }
        }
      }
      step(2, done: nil, "Turn on **Developer mode**: a switch near the top right of that page.") { EmptyView() }
      step(3, done: connected ? true : nil, "Drag the **extension** folder from Finder onto the extensions page and drop it.") {
        HStack {
          Button(showedFolder ? "Show Again" : "Show Folder in Finder") {
            showedFolder = true
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: steps.folder)])
          }
          Button("Copy Path") { model.copyToClipboard(steps.folder) }
            .help("For Load unpacked: press ⌘⇧G in its window and paste")
        }
      }
      Text("Or click **Load unpacked**, press **⌘⇧G**, paste the path (Copy Path) and click **Select**.")
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.leading, 26)

      HStack(alignment: .top, spacing: 8) {
        Image(systemName: connected ? "checkmark.circle.fill" : "circle.dotted")
          .foregroundStyle(connected ? Color.green : Color.secondary)
          .frame(width: 18)
        VStack(alignment: .leading, spacing: 4) {
          if connected {
            Text("\(name) is connected. Open claude.ai: Settings → Appearance has Cinnamon's rows, and your theme is on.")
              .font(.callout)
              .fixedSize(horizontal: false, vertical: true)
          } else {
            HStack(spacing: 6) {
              ProgressView().controlSize(.small)
              Text("Waiting for \(name) to connect…").font(.callout)
            }
            Text("It connects as soon as the extension is added and claude.ai is open.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
          Button("Open claude.ai in \(name)") { model.openClaudeWeb(in: steps.browser) }
            .controlSize(.small)
        }
      }

      HStack {
        Spacer()
        Button(connected ? "Done" : "Close") { model.browserSteps = nil }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
      }
    }
    .padding(12)
    .background(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor.opacity(0.5)))
    .onAppear {
      openedPage = steps.openedPage
      showedFolder = steps.openedPage
      poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
        Task { @MainActor in await AppModel.shared.refreshBrowsers() }
      }
    }
    .onDisappear { poll?.invalidate(); poll = nil }
  }

  private func bullet(_ text: LocalizedStringKey) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text("•").foregroundStyle(.secondary)
      Text(text).font(.caption).fixedSize(horizontal: false, vertical: true)
    }
  }

  /** done: true = checked, false = to do, nil = can't be checked from here (a number). */
  private func step<Actions: View>(_ n: Int, done: Bool?, _ text: LocalizedStringKey, @ViewBuilder actions: () -> Actions) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Group {
        if done == true {
          Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.green)
        } else {
          Text("\(n)")
            .font(.caption.weight(.bold))
            .frame(width: 18, height: 18)
            .background(Circle().fill(Color.accentColor.opacity(0.2)))
        }
      }
      .frame(width: 18)
      VStack(alignment: .leading, spacing: 6) {
        Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
        actions().controlSize(.small)
      }
    }
  }
}

/** Its own window, from the menu. */
struct BrowserWindowView: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        BrowserSection()
        if let busy = model.busy {
          HStack(spacing: 6) { ProgressView().controlSize(.small); Text(busy).foregroundStyle(.secondary) }
        } else if let message = model.message {
          Text(message)
            .font(.caption)
            .foregroundStyle(model.messageIsError ? Color.red : Color.secondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .padding(20)
    }
    .frame(minWidth: 480, minHeight: 360)
  }
}
