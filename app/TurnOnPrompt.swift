// Guided mode (`cinnamon permissions none`, the default for a new install): when Claude starts and Cinnamon isn't on
// in it yet, a small card asks the person to choose Developer → Enable Main Process Debugger in Claude, and goes away
// once Cinnamon is on. It is Cinnamon's own window, so it needs no permission (not even notifications).
import AppKit
import SwiftUI

@MainActor
final class TurnOnPrompt: ObservableObject {
  static let shared = TurnOnPrompt()
  nonisolated static let claudeId = "com.anthropic.claudefordesktop"

  private var panel: NSPanel?
  private var poll: Timer?
  /** The Claude process the person said "Not now" for: asked again at its next launch. */
  private var dismissedFor: Int?
  private var currentPid: Int?
  /** Not Now with no Claude process known: quiet until Claude next starts. */
  private var quietUntilLaunch = false
  private var checking = false

  func start() {
    let center = NSWorkspace.shared.notificationCenter
    center.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { note in
      guard (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier == TurnOnPrompt.claudeId else { return }
      Task { @MainActor in
        TurnOnPrompt.shared.quietUntilLaunch = false
        await TurnOnPrompt.shared.check(after: 2)
      }
    }
    center.addObserver(forName: NSWorkspace.didTerminateApplicationNotification, object: nil, queue: .main) { note in
      guard (note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)?.bundleIdentifier == TurnOnPrompt.claudeId else { return }
      Task { @MainActor in TurnOnPrompt.shared.hide() }
    }
    Task { await check(after: 0) }
  }

  /** Shows the card when it is needed (guided mode, set up, Claude open, not applied), hides it otherwise. */
  func check(after seconds: Double) async {
    if seconds > 0 { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
    guard !checking else { return }
    checking = true
    defer { checking = false }
    guard let s = await CLI.json(Status.self, ["status"]) else { hide(); return }
    let needed = s.helper.running && s.permissions?.mode == "none" && s.claude.running && !s.applied
    currentPid = s.claude.pid
    if needed && !quietUntilLaunch && (s.claude.pid == nil || s.claude.pid != dismissedFor) { show() } else { hide() }
    AppModel.shared.status = s
  }

  /** From the menu's Turn On…: shows the card even after Not Now. */
  func showNow() {
    dismissedFor = nil
    quietUntilLaunch = false
    show()
  }

  func notNow() {
    dismissedFor = currentPid
    if currentPid == nil { quietUntilLaunch = true }
    hide()
  }

  private func show() {
    if panel == nil {
      let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 10),
                      styleMask: [.titled, .nonactivatingPanel, .fullSizeContentView], backing: .buffered, defer: false)
      p.titleVisibility = .hidden
      p.titlebarAppearsTransparent = true
      p.isFloatingPanel = true
      p.level = .floating
      p.hidesOnDeactivate = false
      p.isReleasedWhenClosed = false
      p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
      let host = NSHostingView(rootView: TurnOnCard())
      p.contentView = host
      p.setContentSize(host.fittingSize)
      panel = p
    }
    guard let p = panel else { return }
    if !p.isVisible, let screen = NSScreen.main?.visibleFrame {
      p.setFrameTopLeftPoint(NSPoint(x: screen.maxX - p.frame.width - 16, y: screen.maxY - 16))
    }
    p.orderFrontRegardless()
    if poll == nil {
      poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
        Task { @MainActor in await TurnOnPrompt.shared.check(after: 0) }
      }
    }
  }

  func hide() {
    poll?.invalidate()
    poll = nil
    panel?.orderOut(nil)
  }
}

/** The card: what to click in Claude, and what Claude does next. */
struct TurnOnCard: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 8) {
        Image(systemName: "paintpalette").foregroundStyle(.orange)
        Text("Turn on Cinnamon in Claude").font(.headline)
      }
      Text("In Claude's menu bar, choose **Developer → Enable Main Process Debugger**. Cinnamon turns itself on a moment later.")
        .fixedSize(horizontal: false, vertical: true)
      Text("Claude then opens a chrome://inspect tab in Google Chrome, which you can close. Without Chrome, Claude says \u{201C}Inspector session is active\u{201D}: click OK. No Developer menu? In Claude, choose Help → Troubleshooting → Enable Developer Mode.")
        .font(.caption)
        .foregroundStyle(.secondary)
        .fixedSize(horizontal: false, vertical: true)
      HStack {
        Button("Do This for Me…") { Windows.showSetup() }
          .help("Cinnamon can press it for you each time if you allow Accessibility")
        Spacer()
        Button("Not Now") { TurnOnPrompt.shared.notNow() }
        Button("Open Claude") { Links.openClaude() }
          .buttonStyle(.borderedProminent)
      }
      .controlSize(.small)
    }
    .padding(16)
    .frame(width: 360)
  }
}
