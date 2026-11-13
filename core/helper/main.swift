// Cinnamon Helper — re-applies Cinnamon whenever the Claude desktop app starts.
// It is the process that holds the Accessibility permission, so it does the one menu press itself.
// Keep it small and stable: rebuilding changes its signature and macOS then asks for the permission again.
// All other logic lives in core/autoapply.sh / core/apply.sh, which can change freely.
//
//   cinnamon-helper watch --bundle-id <id> --run <script>
//       runs `bash <script> <pid>` for every launch of that app, and once at start if it is already running
//   cinnamon-helper press <pid> [--menu Developer] [--item "Enable Main Process Debugger"] [--timeout 60]
//       waits for the menu item and presses it once
//       exit 0 = pressed, 2 = item never appeared, 3 = no Accessibility permission, 1 = press failed
//   cinnamon-helper front           prints the frontmost app's pid
//   cinnamon-helper activate <pid>  brings that app to the front
import AppKit
import ApplicationServices

setvbuf(stdout, nil, _IOLBF, 0)
let args = CommandLine.arguments
let stamp: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm:ss"; return f }()
func log(_ s: String) { print("\(stamp.string(from: Date())) \(s)") }
func fail(_ code: Int32, _ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(code) }
func option(_ name: String, _ fallback: String) -> String {
  if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
  return fallback
}

func attr(_ el: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}
func children(_ el: AXUIElement) -> [AXUIElement] { attr(el, kAXChildrenAttribute) as? [AXUIElement] ?? [] }
func title(_ el: AXUIElement) -> String? { attr(el, kAXTitleAttribute) as? String }

func menuItem(pid: pid_t, menu: String, item: String) -> AXUIElement? {
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 5)
  guard let bar = attr(app, kAXMenuBarAttribute) else { return nil }
  for top in children(bar as! AXUIElement) where title(top) == menu {
    for m in children(top) {
      for it in children(m) where title(it) == item { return it }
    }
  }
  return nil
}

func press(pid: pid_t) -> Never {
  guard AXIsProcessTrusted() else { fail(3, "Cinnamon Helper is not allowed to use Accessibility") }
  let menu = option("--menu", "Developer")
  let item = option("--item", "Enable Main Process Debugger")
  let deadline = Date().addingTimeInterval(Double(option("--timeout", "60")) ?? 60)
  while Date() < deadline {
    // No checkmark test: menus can show a stale mark. Callers only press when the debugger is off,
    // and Claude's click handler toggles from the real debugger state.
    if let it = menuItem(pid: pid, menu: menu, item: item) {
      let err = AXUIElementPerformAction(it, kAXPressAction as CFString)
      if err == .success { print("pressed"); exit(0) }
      fail(1, "pressing \(menu) > \(item) failed (AXError \(err.rawValue))")
    }
    Thread.sleep(forTimeInterval: 1)
  }
  fail(2, "\(menu) > \(item) never appeared in pid \(pid) (is Developer Mode on?)")
}

func activate(pid: pid_t) -> Never {
  let app = NSRunningApplication(processIdentifier: pid)
  app?.activate(options: [])
  AXUIElementSetAttributeValue(AXUIElementCreateApplication(pid), kAXFrontmostAttribute as CFString, kCFBooleanTrue)
  exit(app == nil ? 1 : 0)
}

var children_: [Process] = []
func watch() -> Never {
  let bundleId = option("--bundle-id", "com.anthropic.claudefordesktop")
  let script = option("--run", "")
  if script.isEmpty { fail(64, "watch needs --run <script>") }
  let me = Bundle.main.executablePath ?? args[0]
  let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
  log("watching \(bundleId); Accessibility \(trusted ? "allowed" : "NOT allowed yet: System Settings > Privacy & Security > Accessibility > Cinnamon Helper")")

  func run(_ pid: pid_t) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = [script, String(pid)]
    var env = ProcessInfo.processInfo.environment
    env["CM_HELPER"] = me
    if env["PATH"] == nil { env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" }
    p.environment = env
    p.terminationHandler = { done in
      DispatchQueue.main.async { children_.removeAll { $0 === done } }
    }
    do { try p.run(); children_.append(p); log("\(bundleId) pid \(pid): running \(script)") }
    catch { log("could not run \(script): \(error)") }
  }

  func runForOpenApps() {
    for app in NSWorkspace.shared.runningApplications where app.bundleIdentifier == bundleId { run(app.processIdentifier) }
  }
  if trusted {
    runForOpenApps()
  } else {
    // Once the permission is granted, apply to the app that is already open instead of waiting for its next launch.
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { t in
      guard AXIsProcessTrusted() else { return }
      t.invalidate()
      log("Accessibility allowed")
      runForOpenApps()
    }
  }
  NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main
  ) { note in
    guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
          app.bundleIdentifier == bundleId else { return }
    guard AXIsProcessTrusted() else { log("\(bundleId) started, but Accessibility is not allowed yet; skipping"); return }
    run(app.processIdentifier)
  }
  RunLoop.main.run()
  exit(0)
}

func pidArg() -> pid_t {
  guard args.count > 2, let p = pid_t(args[2]) else { fail(64, "usage: \(args[0]) \(args[1]) <pid>") }
  return p
}

switch args.count > 1 ? args[1] : "" {
case "watch": watch()
case "press": press(pid: pidArg())
case "activate": activate(pid: pidArg())
case "front": print(NSWorkspace.shared.frontmostApplication.map { String($0.processIdentifier) } ?? ""); exit(0)
default: fail(64, "usage: cinnamon-helper watch|press|front|activate")
}
