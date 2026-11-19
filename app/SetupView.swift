// The Setup window: everything Cinnamon needs, one row each, with what to do about it. The state comes from
// `cinnamon doctor --json`; the buttons run the CLI or open the right place in System Settings or Claude.
import AppKit
import SwiftUI

struct SetupView: View {
  @EnvironmentObject var model: AppModel
  @State private var confirmUninstall = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 14) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Set up Cinnamon").font(.title2.weight(.semibold))
          Text("Cinnamon gives the Claude desktop app new color schemes and extensions. It never changes Claude itself: a small helper applies it each time Claude starts.")
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }

        VStack(spacing: 0) {
          step(state: checkState("claude"), title: "The Claude desktop app",
               detail: "Cinnamon works with Claude for Mac, installed in Applications.") {
            Button("Download Claude") { NSWorkspace.shared.open(Links.claudeDownload) }
          }
          Divider()
          step(state: installState, title: "Cinnamon Helper",
               detail: "A small login item that applies Cinnamon whenever Claude starts. Setting it up also adds Cinnamon's Claude Code mod and skill.") {
            Button(model.isSetUp ? "Reinstall" : "Install") { Task { await model.install() } }
              .buttonStyle(.borderedProminent)
          }
          Divider()
          permissionsStep
          Divider()
          if !model.isManual {
            step(state: checkState("accessibility"), title: "Accessibility permission",
                 detail: "The helper turns on Claude's debugger through Claude's own Developer menu, so macOS asks you to allow Cinnamon Helper under Privacy & Security → Accessibility.") {
              Button("Open System Settings") { NSWorkspace.shared.open(Links.accessibility) }
            }
            Divider()
          }
          step(state: model.isManual ? .info : checkState("developer-mode"), title: "Developer Mode in Claude",
               detail: "In Claude, choose Help → Troubleshooting → Enable Developer Mode. Cinnamon needs the Developer menu it adds.\(model.isManual ? "" : " This is checked the next time Claude starts.")") {
            Button("Open Claude") { Links.openClaude() }
          }
          Divider()
          step(state: .info, title: "The Chrome tab Claude opens",
               detail: "Turning on Claude's debugger makes Claude open a chrome://inspect tab in Google Chrome. Cinnamon can close it, but macOS then asks whether Cinnamon Helper may control Google Chrome (Automation).") {
            Toggle("Close it", isOn: Binding(get: { model.status?.permissions?.closeChromeTab ?? false },
                                            set: { on in Task { await model.setCloseChromeTab(on) } }))
              .toggleStyle(.switch)
              .controlSize(.small)
          }
          Divider()
          step(state: claudeCodeState, title: "Claude Code",
               detail: "A mod paints the Code tab through Claude Code's own theme API, and a skill lets Claude change themes and extensions when you ask it to.") {
            Button("Install") { Task { await model.install() } }
          }
        }
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))

        BrowserSection().padding(.top, 4)

        if !otherProblems.isEmpty {
          VStack(alignment: .leading, spacing: 6) {
            Text("Other problems").font(.headline)
            ForEach(otherProblems) { c in
              HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                VStack(alignment: .leading, spacing: 2) {
                  Text(c.text).textSelection(.enabled)
                  if let fix = c.fix { Text(fix).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
                }
              }
            }
          }
        }

        if let notes = model.doctor?.notes, !notes.isEmpty {
          Text(notes.joined(separator: "\n")).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
        }

        if let busy = model.busy {
          HStack(spacing: 6) { ProgressView().controlSize(.small); Text(busy).foregroundStyle(.secondary) }
        } else if let message = model.message {
          ScrollView {
            Text(message)
              .font(.system(.caption, design: .monospaced))
              .foregroundStyle(model.messageIsError ? Color.red : Color.primary)
              .textSelection(.enabled)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          .frame(maxHeight: 140)
          .padding(8)
          .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
        }

        Toggle("Open Cinnamon at login", isOn: Binding(get: { model.launchAtLogin }, set: { model.setLaunchAtLogin($0) }))

        HStack {
          Button("Check Again") { Task { await model.refresh(); await model.refreshDoctor(); await model.refreshBrowsers() } }
          Button("Show Log") { Task { Windows.showLog(await model.logs()) } }
          Button("Project Page") { NSWorkspace.shared.open(Links.project) }
          Spacer()
          Button("Uninstall Cinnamon…", role: .destructive) { confirmUninstall = true }
            .disabled(!model.isSetUp)
        }
      }
      .padding(20)
      .disabled(model.busy != nil)
    }
    .frame(minWidth: 520, minHeight: 520)
    .task { await model.refresh(); await model.refreshDoctor() }
    .alert("Uninstall Cinnamon?", isPresented: $confirmUninstall) {
      Button("Uninstall", role: .destructive) { Task { await model.uninstall() } }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text("This removes the helper, its login item and Cinnamon's Claude Code mod and skill. Claude goes back to its own look the next time it starts. Your themes and settings stay in your folder.")
    }
  }

  /** Accessibility (turns itself on) or none (you press Claude's menu item). */
  private var permissionsStep: some View {
    step(state: .info, title: "Permissions",
         detail: model.isManual
           ? "None. Each time Claude starts, choose Developer → Enable Main Process Debugger in Claude, and Cinnamon applies itself."
           : "Accessibility only: Cinnamon turns itself on each time Claude starts, by pressing Developer → Enable Main Process Debugger for you. Nothing else (no Screen Recording, Full Disk Access or Input Monitoring).") {
      Picker("", selection: Binding(get: { model.isManual ? "none" : "accessibility" },
                                    set: { mode in Task { await model.setPermissionMode(mode) } })) {
        Text("Automatic").tag("accessibility")
        Text("None").tag("none")
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .frame(width: 160)
    }
  }

  // MARK: state of each step

  enum StepState { case ok, problem, unknown, info }

  private func checkState(_ id: String) -> StepState {
    guard let c = model.doctor?.check(id) else { return model.doctor == nil ? .unknown : .info }
    return c.ok ? .ok : .problem
  }

  private var installState: StepState {
    if model.cliMissing { return .problem }
    guard let s = model.status else { return .unknown }
    return s.helper.running ? .ok : .problem
  }

  private var claudeCodeState: StepState {
    guard let d = model.doctor else { return .unknown }
    let mod = d.check("mod")?.ok ?? false, skill = d.check("skill")?.ok ?? false
    return mod && skill ? .ok : .problem
  }

  private static let stepIds: Set<String> = ["bun", "claude", "swiftc", "helper", "helper-app", "accessibility", "developer-mode", "mod", "skill"]
  private var otherProblems: [DoctorReport.Check] {
    (model.doctor?.checks ?? []).filter { !$0.ok && !Self.stepIds.contains($0.id) }
  }

  private func step<Fix: View>(state: StepState, title: String, detail: String, @ViewBuilder fix: () -> Fix) -> some View {
    HStack(alignment: .top, spacing: 12) {
      icon(state).frame(width: 20)
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(detail).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
      }
      Spacer(minLength: 8)
      if state != .ok { fix().controlSize(.small) }
    }
    .padding(12)
  }

  @ViewBuilder private func icon(_ state: StepState) -> some View {
    switch state {
    case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
    case .problem: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
    case .unknown: ProgressView().controlSize(.small)
    case .info: Image(systemName: "info.circle").foregroundStyle(.secondary)
    }
  }
}

/** Adds themes or an extension from GitHub, a git URL or a folder: shows what was found, then installs on a yes. */
struct GetMoreView: View {
  @EnvironmentObject var model: AppModel
  @State private var kind = "theme"
  @State private var source = ""
  @State private var preview: String?
  @State private var result: CommandResult?

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Get more themes and extensions").font(.title3.weight(.semibold))
      Picker("", selection: $kind) {
        Text("Themes").tag("theme")
        Text("Extension").tag("ext")
      }
      .pickerStyle(.segmented)
      .labelsHidden()
      .onChange(of: kind) { _ in preview = nil; result = nil }
      TextField("owner/repo, a GitHub link or a folder", text: $source)
        .textFieldStyle(.roundedBorder)
        .onSubmit { Task { await look() } }
      Text(kind == "theme"
           ? "Themes only change colors and styles; they can't run code."
           : "An extension runs inside Claude's window and can read anything shown there. Only install extensions you trust.")
        .font(.caption)
        .foregroundStyle(kind == "theme" ? Color.secondary : Color.orange)

      if let preview {
        ScrollView {
          Text(preview).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
      }
      if let result {
        Text(result.text).font(.caption).foregroundStyle(result.ok ? Color.green : Color.red).textSelection(.enabled)
      }
      Spacer()
      HStack {
        if let busy = model.busy { ProgressView().controlSize(.small); Text(busy).font(.caption).foregroundStyle(.secondary) }
        Spacer()
        if preview == nil || result != nil {
          Button("Look") { Task { await look() } }
            .keyboardShortcut(.defaultAction)
            .disabled(source.trimmingCharacters(in: .whitespaces).isEmpty || model.busy != nil)
        } else {
          Button("Cancel") { preview = nil }
          Button("Install") { Task { result = await model.installSource(kind: kind, source: trimmed) } }
            .keyboardShortcut(.defaultAction)
            .disabled(model.busy != nil)
        }
      }
    }
    .padding(20)
    .frame(minWidth: 480, minHeight: 360)
  }

  private var trimmed: String { source.trimmingCharacters(in: .whitespacesAndNewlines) }

  /** The first pass: what the source holds (nothing is installed without --yes). */
  private func look() async {
    result = nil
    let r = await model.preview(kind: kind, source: trimmed)
    // "Not asking without a terminal" is the expected end of a preview; anything else before it is the report
    let lines = r.text.split(separator: "\n").map(String.init).filter { !$0.contains("Not asking without a terminal") }
    if lines.isEmpty || r.text.contains("✗") { result = r; preview = nil; return }
    preview = lines.joined(separator: "\n")
  }
}
