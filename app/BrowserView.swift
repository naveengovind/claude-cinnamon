// Claude in your browser: Cinnamon's themes and extensions on claude.ai too, through a small extension that the
// `cinnamon browser` command sets up for each browser. Lists the browsers on this Mac (`cinnamon browser list --json`)
// with Set Up / Remove, then walks the person through the three clicks only they can do in the browser.
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

  var body: some View {
    HStack(spacing: 10) {
      BrowserIcon(name: browser.name)
      VStack(alignment: .leading, spacing: 2) {
        Text(browser.name)
        Text(browser.registered ? "Set up" : "Not set up")
          .font(.caption)
          .foregroundStyle(browser.registered ? Color.green : Color.secondary)
      }
      Spacer()
      if browser.registered {
        Button("Show Steps") { model.browserSteps = BrowserSteps(browser: browser, folder: model.browsers?.extensionDir ?? "") }
          .controlSize(.small)
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

/** The three clicks only the person can do in the browser (browsers don't let other programs add extensions). */
struct BrowserStepsView: View {
  @EnvironmentObject var model: AppModel
  let steps: BrowserSteps

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text("Finish in \(steps.browser.name)").font(.headline)
        Spacer()
        Button { model.browserSteps = nil } label: { Image(systemName: "xmark") }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
          .help("Close")
      }
      Text("\(steps.browser.name) just opened its extensions page (\(steps.browser.extensionsUrl)), and Finder is showing the extension folder. Do this once:")
        .font(.callout)
        .fixedSize(horizontal: false, vertical: true)
      step(1, "Turn on **Developer mode** (a switch near the top right).")
      step(2, "Drag the **extension** folder from Finder onto the extensions page and drop it. (Or click **Load unpacked**, press **⌘⇧G**, paste the path below and click **Select**.)")
      HStack(spacing: 6) {
        Text(steps.folder)
          .font(.system(.caption, design: .monospaced))
          .textSelection(.enabled)
          .lineLimit(2)
          .truncationMode(.middle)
        Spacer()
        Button("Copy") { model.copyToClipboard(steps.folder) }.controlSize(.small)
      }
      .padding(8)
      .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.06)))
      .padding(.leading, 26)
      Text("Then open claude.ai: Settings → Appearance has Cinnamon's rows, just like the desktop app. Updates come with Cinnamon's own updates; nothing to do in the browser.")
        .font(.callout)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      HStack {
        Button("Open the Extensions Page Again") { Task { await model.installBrowser(steps.browser) } }
          .controlSize(.small)
        Spacer()
        Button("Done") { model.browserSteps = nil }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
      }
    }
    .padding(12)
    .background(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.accentColor.opacity(0.5)))
  }

  private func step(_ n: Int, _ text: LocalizedStringKey) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      Text("\(n)")
        .font(.caption.weight(.bold))
        .frame(width: 18, height: 18)
        .background(Circle().fill(Color.accentColor.opacity(0.2)))
      Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
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
