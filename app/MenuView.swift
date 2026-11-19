// The panel under the menu bar icon: color schemes, extensions and the everyday actions.
import AppKit
import SwiftUI

struct MenuView: View {
  @EnvironmentObject var model: AppModel

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      if model.cliMissing {
        notSetUp(text: "The cinnamon command isn't on this Mac yet.")
      } else if let s = model.status, !s.helper.running {
        notSetUp(text: "Cinnamon isn't set up yet.")
      }
      if let s = model.status, s.helper.running {
        section("Running in")
        VStack(spacing: 4) {
          claudeRow(s)
          ForEach(s.browsers ?? [], id: \.id) { b in browserRow(b) }
        }
      }
      if !model.themes.isEmpty {
        section("Color scheme")
        VStack(spacing: 2) {
          ForEach(model.themes) { theme in ThemeRow(theme: theme, selected: theme.id == model.currentTheme) }
        }
      }
      if !model.extensions.isEmpty {
        section("Extensions")
        VStack(spacing: 4) {
          ForEach(model.extensions) { ext in ExtensionRow(ext: ext) }
        }
      }
      if let busy = model.busy {
        HStack(spacing: 6) { ProgressView().controlSize(.small); Text(busy).font(.caption).foregroundStyle(.secondary) }
      } else if let message = model.message {
        Text(message)
          .font(.caption)
          .foregroundStyle(model.messageIsError ? Color.red : Color.secondary)
          .lineLimit(6)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
      }
      Divider()
      actions
    }
    .padding(12)
    .frame(width: 320)
    .task { await model.refresh() }
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline) {
      Text("Cinnamon").font(.headline)
      Spacer()
      Circle().fill(statusColor).frame(width: 8, height: 8)
      Text(statusText).font(.caption).foregroundStyle(.secondary)
    }
  }

  private var statusColor: Color {
    guard let s = model.status, s.helper.running else { return .orange }
    if !s.claude.running { return .gray }
    return s.applied ? .green : .yellow
  }

  private var statusText: String {
    guard let s = model.status else { return model.cliMissing ? "Not installed" : "…" }
    if !s.helper.running { return "Not set up" }
    if !s.claude.running { return "Claude isn't running" }
    if s.applied { return "On in Claude" }
    return model.isManual ? "In Claude: Developer → Enable Main Process Debugger" : "Not applied yet"
  }

  /** Cinnamon inside the Claude app: on, not on yet (with the way to turn it on), or Claude isn't open. */
  private func claudeRow(_ s: Status) -> some View {
    HStack(spacing: 8) {
      Circle().fill(!s.claude.running ? Color.gray : s.applied ? Color.green : Color.orange).frame(width: 7, height: 7)
      Text("Claude app").font(.callout)
      Spacer()
      if !s.claude.running {
        Text("Not open").font(.caption).foregroundStyle(.secondary)
      } else if s.applied {
        Text("On").font(.caption).foregroundStyle(.secondary)
      } else if model.isManual {
        Button("Turn On…") { TurnOnPrompt.shared.showNow() }.controlSize(.small)
      } else {
        Button("Apply Now") { Task { await model.applyNow() } }.controlSize(.small)
      }
    }
  }

  /** The extension in one browser: connected now, added (connects while claude.ai is open), or not added yet. */
  private func browserRow(_ b: Status.BrowserLink) -> some View {
    HStack(spacing: 8) {
      Circle().fill(b.link == "connected" ? Color.green : b.link == "idle" ? Color.green.opacity(0.45) : Color.orange).frame(width: 7, height: 7)
      Text(b.name).font(.callout)
      Spacer()
      switch b.link {
      case "connected": Text("Connected").font(.caption).foregroundStyle(.secondary)
      case "idle": Text("Added").font(.caption).foregroundStyle(.secondary).help("Connects while claude.ai is open")
      default: Button("Finish Adding…") { Windows.showBrowsers(finishing: b.id) }.controlSize(.small)
      }
    }
  }

  private func notSetUp(text: String) -> some View {
    HStack {
      Text(text).font(.callout)
      Spacer()
      Button("Set Up…") { Windows.showSetup() }.buttonStyle(.borderedProminent).controlSize(.small)
    }
    .padding(8)
    .background(RoundedRectangle(cornerRadius: 6).fill(Color.orange.opacity(0.12)))
  }

  private func section(_ title: String) -> some View {
    Text(title.uppercased()).font(.caption2.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 2)
  }

  private var actions: some View {
    VStack(alignment: .leading, spacing: 2) {
      MenuButton("Apply Now", systemImage: "arrow.clockwise") { Task { await model.applyNow() } }
        .disabled(!(model.status?.claude.running ?? false))
      MenuButton("Take Screenshot…", systemImage: "camera") { saveScreenshot() }
        .disabled(!(model.status?.claude.running ?? false))
      MenuButton("Get More Themes and Extensions…", systemImage: "plus.circle") { Windows.showGetMore() }
      MenuButton("Use in a Browser…", systemImage: "globe") { Windows.showBrowsers() }
      MenuButton("Open Themes Folder", systemImage: "folder") { model.openUserFolder("themes") }
      MenuButton("Check for Updates", systemImage: "arrow.down.circle") { Task { await model.update() } }
      MenuButton("Setup and Help…", systemImage: "gearshape") { Windows.showSetup() }
      Divider().padding(.vertical, 2)
      MenuButton("Quit Cinnamon", systemImage: "power") { NSApp.terminate(nil) }
    }
    .disabled(model.busy != nil)
  }

  private func saveScreenshot() {
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.png]
    panel.nameFieldStringValue = "Claude.png"
    panel.directoryURL = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
    NSApp.activate(ignoringOtherApps: true)
    guard panel.runModal() == .OK, let url = panel.url else { return }
    Task { await model.screenshot(to: url) }
  }
}

private struct ThemeRow: View {
  @EnvironmentObject var model: AppModel
  let theme: ThemeList.Theme
  let selected: Bool
  @State private var hover = false

  var body: some View {
    Button {
      if !selected { Task { await model.setTheme(theme.id) } }
    } label: {
      HStack(spacing: 8) {
        Image(systemName: "checkmark").opacity(selected ? 1 : 0).frame(width: 14)
        VStack(alignment: .leading, spacing: 1) {
          Text(theme.name)
          if let error = theme.error {
            Text(error).font(.caption2).foregroundStyle(.red).lineLimit(1)
          } else if !theme.description.isEmpty {
            Text(theme.description).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        Spacer()
      }
      .contentShape(Rectangle())
      .padding(.vertical, 3)
      .padding(.horizontal, 6)
      .background(RoundedRectangle(cornerRadius: 5).fill(hover ? Color.primary.opacity(0.08) : .clear))
    }
    .buttonStyle(.plain)
    .disabled(theme.error != nil || model.busy != nil)
    .onHover { hover = $0 }
  }
}

private struct ExtensionRow: View {
  @EnvironmentObject var model: AppModel
  let ext: ExtensionList.Ext

  var body: some View {
    Toggle(isOn: Binding(get: { ext.enabled }, set: { on in Task { await model.setExtension(ext.id, on: on) } })) {
      VStack(alignment: .leading, spacing: 1) {
        Text(ext.name)
        if let error = ext.errors.first {
          Text(error).font(.caption2).foregroundStyle(.red).lineLimit(2)
        } else if !ext.description.isEmpty {
          Text(ext.description).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .toggleStyle(.switch)
    .controlSize(.small)
    .padding(.horizontal, 6)
    .disabled(model.busy != nil)
  }
}

/** A full-width, menu-like button with an icon. */
struct MenuButton: View {
  let title: String
  let systemImage: String
  let action: () -> Void
  @State private var hover = false

  init(_ title: String, systemImage: String, action: @escaping () -> Void) {
    self.title = title
    self.systemImage = systemImage
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Image(systemName: systemImage).frame(width: 16)
        Text(title)
        Spacer()
      }
      .contentShape(Rectangle())
      .padding(.vertical, 4)
      .padding(.horizontal, 6)
      .background(RoundedRectangle(cornerRadius: 5).fill(hover ? Color.primary.opacity(0.08) : .clear))
    }
    .buttonStyle(.plain)
    .onHover { hover = $0 }
  }
}
