// What the menu and the windows show, and what they do: all of it through the `cinnamon` command (CLI.swift).
import AppKit
import Foundation
import ServiceManagement

@MainActor
final class AppModel: ObservableObject {
  static let shared = AppModel()

  @Published var status: Status?
  @Published var themes: [ThemeList.Theme] = []
  @Published var currentTheme = "default"
  @Published var extensions: [ExtensionList.Ext] = []
  @Published var doctor: DoctorReport?
  /** What is running now ("Applying…"), shown with a spinner; nil when idle. */
  @Published var busy: String?
  /** The last command's output worth showing (an error, an install's report). */
  @Published var message: String?
  @Published var messageIsError = false
  @Published var cliMissing = false
  @Published var launchAtLogin = false
  /** Browsers for Claude on the web (`cinnamon browser list --json`). */
  @Published var browsers: BrowserList?
  /** After a browser install: the one-time steps to finish it in that browser. */
  @Published var browserSteps: BrowserSteps?

  private var watcher: DispatchSourceFileSystemObject?
  private var watchedDir: String?

  /** Cinnamon is set up: its login item is running. */
  var isSetUp: Bool { status?.helper.running ?? false }

  init() {
    launchAtLogin = SMAppService.mainApp.status == .enabled
  }

  // MARK: reading

  func refresh() async {
    cliMissing = CLI.locate() == nil
    if cliMissing { return }
    async let s = CLI.json(Status.self, ["status"])
    async let t = CLI.json(ThemeList.self, ["theme", "list"])
    async let e = CLI.json(ExtensionList.self, ["ext", "list"])
    let (status, themes, exts) = await (s, t, e)
    if let status { self.status = status; watch(status.user) }
    if let themes { self.themes = themes.themes; currentTheme = themes.current }
    if let exts { extensions = exts.extensions }
  }

  func refreshDoctor() async {
    if CLI.locate() == nil { cliMissing = true; return }
    doctor = await CLI.json(DoctorReport.self, ["doctor"])
  }

  /** Follows changes made elsewhere (the CLI, Claude's Settings rows, Claude Code) by watching the settings folder. */
  private func watch(_ dir: String) {
    guard watchedDir != dir else { return }
    watcher?.cancel()
    let fd = open(dir, O_EVTONLY)
    guard fd >= 0 else { return }
    let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: .main)
    source.setEventHandler { [weak self] in Task { await self?.refresh() } }
    source.setCancelHandler { close(fd) }
    source.resume()
    watcher = source
    watchedDir = dir
  }

  // MARK: doing

  /** Runs a command with a spinner; shows its output when it fails (or always, with `show`). */
  @discardableResult
  func perform(_ label: String, _ args: [String], show: Bool = false, using exe: String? = nil) async -> CommandResult {
    busy = label
    defer { busy = nil }
    let r = await CLI.run(args, using: exe)
    if !r.ok || show {
      message = r.text.isEmpty ? (r.ok ? "Done." : "That didn't work (exit \(r.status)).") : r.text
      messageIsError = !r.ok
    } else {
      message = nil
    }
    await refresh()
    return r
  }

  func setTheme(_ id: String) async {
    currentTheme = id // right away, so the checkmark moves with the click
    await perform("Switching to \(themes.first { $0.id == id }?.name ?? id)…", ["theme", id])
  }

  func setExtension(_ id: String, on: Bool) async {
    if let i = extensions.firstIndex(where: { $0.id == id }) {
      let e = extensions[i]
      extensions[i] = ExtensionList.Ext(id: e.id, name: e.name, description: e.description, bundled: e.bundled, enabled: on, errors: e.errors)
    }
    await perform(on ? "Turning on…" : "Turning off…", ["ext", on ? "enable" : "disable", id])
  }

  /** "accessibility" or "none" (`cinnamon permissions <mode>`). */
  func setPermissionMode(_ mode: String) async {
    await perform(mode == "none" ? "Switching to no permissions…" : "Switching to Accessibility…", ["permissions", mode])
    await refreshDoctor()
  }

  func setCloseChromeTab(_ on: Bool) async {
    await perform(on ? "Turning on…" : "Turning off…", ["permissions", "chrome-tab", on ? "on" : "off"])
  }

  var isManual: Bool { status?.permissions?.mode == "none" }

  func applyNow() async {
    await perform(isManual ? "In Claude, choose Developer → Enable Main Process Debugger…" : "Applying to Claude…", ["apply"], show: true)
  }

  func screenshot(to url: URL) async {
    let r = await perform("Taking a picture of Claude…", ["screenshot", "--out", url.path])
    if r.ok { NSWorkspace.shared.activateFileViewerSelecting([url]) }
  }

  /**
   * Sets Cinnamon up (`cinnamon install`): the login item, the Claude Code mod and skill. With only the app's own
   * copy of the command, that copy goes to ~/.local/bin first, so later updates never write inside the app.
   */
  func install() async {
    var exe: String? = nil
    if CLI.onlyBundled {
      switch CLI.bootstrap() {
      case .success(let path): exe = path
      case .failure(let error):
        message = "Could not put the cinnamon command in place: \(error.localizedDescription)"
        messageIsError = true
        return
      }
    }
    await perform("Setting up Cinnamon…", ["install"], show: true, using: exe)
    await refreshDoctor()
  }

  func uninstall() async {
    await perform("Removing Cinnamon…", ["uninstall"], show: true)
    await refreshDoctor()
  }

  /** `cinnamon update`; an app that `cinnamon app install` put in ~/Applications is refreshed and restarted too. */
  func update() async {
    let r = await perform("Checking for updates…", ["update"], show: true)
    guard r.ok, Bundle.main.bundlePath == "\(CLI.home)/Applications/Cinnamon.app" else { return }
    let refreshed = await CLI.run(["app", "install", "--no-open"])
    if refreshed.ok { relaunch() }
  }

  /** First pass of an install from GitHub (no --yes): the command shows what it found and installs nothing. */
  func preview(kind: String, source: String) async -> CommandResult {
    busy = "Looking at \(source)…"
    defer { busy = nil }
    return await CLI.run([kind, "install", source])
  }

  func installSource(kind: String, source: String) async -> CommandResult {
    await perform("Installing…", [kind, "install", source, "--yes"], show: true)
  }

  func logs() async -> String { await CLI.run(["logs"]).text }

  // MARK: Claude in a browser

  func refreshBrowsers() async {
    if CLI.locate() == nil { cliMissing = true; return }
    browsers = await CLI.json(BrowserList.self, ["browser", "list"])
  }

  /**
   * `cinnamon browser install --browser <id>`: builds the extension and lets that browser start Cinnamon. The command
   * opens the browser's extensions page and copies the folder path; the person finishes there (BrowserSteps).
   */
  func installBrowser(_ b: BrowserList.Browser) async {
    let r = await perform("Setting up \(b.name)…", ["browser", "install", "--browser", b.id])
    await refreshBrowsers()
    guard r.ok else { return }
    // "Updated in place" means it was already loaded and connected: nothing left to do in the browser
    if r.stdout.contains("Updated in place") {
      browserSteps = nil
      message = "\(b.name) is up to date. Open claude.ai to use it."
      messageIsError = false
      return
    }
    browserSteps = BrowserSteps(browser: b, folder: browsers?.extensionDir ?? "")
    message = nil
  }

  func removeBrowser(_ b: BrowserList.Browser) async {
    await perform("Removing Cinnamon from \(b.name)…", ["browser", "uninstall", "--browser", b.id])
    if browserSteps?.browser.id == b.id { browserSteps = nil }
    await refreshBrowsers()
  }

  func copyToClipboard(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
  }

  func setLaunchAtLogin(_ on: Bool) {
    do {
      if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    } catch {
      message = "Could not change Open at login: \(error.localizedDescription)"
      messageIsError = true
    }
    launchAtLogin = SMAppService.mainApp.status == .enabled
  }

  func openUserFolder(_ sub: String) {
    guard let user = status?.user else { return }
    let path = "\(user)/\(sub)"
    try? FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
    NSWorkspace.shared.open(URL(fileURLWithPath: path))
  }

  func relaunch() {
    let path = Bundle.main.bundlePath
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/sh")
    p.arguments = ["-c", "sleep 1; /usr/bin/open \"$0\"", path]
    try? p.run()
    NSApp.terminate(nil)
  }
}

/** What is left to do in the browser after `cinnamon browser install`: shown until the person closes it. */
struct BrowserSteps: Equatable {
  let browser: BrowserList.Browser
  /** The folder to load as an unpacked extension (the command copied it to the clipboard too). */
  let folder: String
}

enum Links {
  static let claudeDownload = URL(string: "https://claude.ai/download")!
  static let accessibility = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
  static let automation = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")!
  static let project = URL(string: "https://github.com/naveengovind/claude-cinnamon")!

  static func openClaude() {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.anthropic.claudefordesktop") {
      NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
    }
  }
}
