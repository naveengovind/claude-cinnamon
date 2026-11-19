// Cinnamon Helper — re-applies Cinnamon whenever the Claude desktop app starts.
// It is the process that holds the Accessibility permission, so it does the one menu press itself.
// Keep it small and stable: rebuilding changes its signature and macOS then asks for the permission again.
// All other logic lives in core/autoapply.sh / core/apply.sh, which can change freely.
//
//   cinnamon-helper watch --bundle-id <id> --run <script> [--no-accessibility]
//       runs `bash <script> <pid>` for every launch of that app, and once at start if it is already running
//       (--no-accessibility: never asks for the permission; the script waits for you to turn the debugger on)
//   cinnamon-helper press <pid> [--menu Developer] [--item "Enable Main Process Debugger"] [--timeout 60]
//       waits for the menu item and presses it once
//       exit 0 = pressed, 2 = item never appeared, 3 = no Accessibility permission, 1 = press failed
//   cinnamon-helper inspect-tabs    prints {"running":bool,"count":n}: is Google Chrome running, and how many
//                                   chrome://inspect tabs it has (-1 without Accessibility)
//   cinnamon-helper close-inspect-tab --known <n> [--launched] [--timeout 15]
//       waits for a chrome://inspect tab beyond the <n> known before the press (the one Claude opens), closes it
//       with Accessibility (no Automation permission), and with --launched quits Chrome if that left it with no
//       windows. exit 0 = closed, 2 = none appeared, 3 = no Accessibility permission
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

// MARK: the chrome://inspect tab Claude opens in Google Chrome

let chromeId = "com.google.Chrome"
/** chrome://inspect's page title: hard-coded English in Chromium (chrome/browser/resources/inspect/inspect.html). */
let inspectTitle = "Inspect with Chrome Developer Tools"

func string(_ el: AXUIElement, _ name: String) -> String? { attr(el, name) as? String }

/** Chrome's tabs titled chrome://inspect, in every window (the tab strip only: web content is skipped). */
func inspectTabs(pid: pid_t) -> [AXUIElement] {
  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, 2)
  var found: [AXUIElement] = []
  for w in attr(app, kAXWindowsAttribute) as? [AXUIElement] ?? [] {
    var queue: [(AXUIElement, String?)] = [(w, nil)]
    var seen = 0
    while !queue.isEmpty && seen < 4000 {
      let (el, parentRole) = queue.removeFirst()
      seen += 1
      let role = string(el, kAXRoleAttribute)
      if role == "AXWebArea" { continue }
      let isTab = string(el, kAXSubroleAttribute) == "AXTabButton" || (role == (kAXRadioButtonRole as String) && parentRole == (kAXTabGroupRole as String))
      if isTab {
        if string(el, kAXTitleAttribute) == inspectTitle || string(el, kAXDescriptionAttribute) == inspectTitle { found.append(el) }
        continue
      }
      for c in children(el) { queue.append((c, role)) }
    }
  }
  return found
}

/** A menu item by its key equivalent (⌘W, ⌘Q): the same in every language, unlike its title. */
func menuItem(pid: pid_t, key: String, modifiers: Int = 0) -> AXUIElement? {
  let app = AXUIElementCreateApplication(pid)
  guard let bar = attr(app, kAXMenuBarAttribute) else { return nil }
  for top in children(bar as! AXUIElement) {
    for m in children(top) {
      for it in children(m) where string(it, kAXMenuItemCmdCharAttribute) == key && (attr(it, kAXMenuItemCmdModifiersAttribute) as? Int) == modifiers {
        return it
      }
    }
  }
  return nil
}

func chrome() -> NSRunningApplication? { NSRunningApplication.runningApplications(withBundleIdentifier: chromeId).first }

func reportInspectTabs() -> Never {
  let app = chrome()
  let count = app == nil ? 0 : (AXIsProcessTrusted() ? inspectTabs(pid: app!.processIdentifier).count : -1)
  print("{\"running\":\(app != nil),\"count\":\(count)}")
  exit(0)
}

func closeInspectTab() -> Never {
  guard AXIsProcessTrusted() else { fail(3, "Cinnamon Helper is not allowed to use Accessibility") }
  let known = Int(option("--known", "0")) ?? 0
  let launched = args.contains("--launched")
  let deadline = Date().addingTimeInterval(Double(option("--timeout", "15")) ?? 15)
  while Date() < deadline {
    if let app = chrome() {
      let pid = app.processIdentifier
      let tabs = inspectTabs(pid: pid)
      if tabs.count > known {
        // the new one is the selected tab of its window; else the last found
        let tab = tabs.first { (attr($0, kAXValueAttribute) as? Int) == 1 } ?? tabs.last!
        var closed = false
        if let close = children(tab).first(where: { string($0, kAXRoleAttribute) == (kAXButtonRole as String) }) {
          closed = AXUIElementPerformAction(close, kAXPressAction as CFString) == .success
        }
        if !closed {
          // select it, then File > Close Tab (⌘W) — only while the focused window shows it
          AXUIElementPerformAction(tab, kAXPressAction as CFString)
          let window = attr(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute)
          if let w = window, string(w as! AXUIElement, kAXTitleAttribute)?.hasPrefix(inspectTitle) == true, let item = menuItem(pid: pid, key: "W") {
            closed = AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
          }
        }
        if !closed { fail(1, "could not close the chrome://inspect tab") }
        var quit = false
        if launched {
          // only a Chrome that Claude started, and only when that tab was all it had open
          for _ in 0..<20 {
            Thread.sleep(forTimeInterval: 0.1)
            if (attr(AXUIElementCreateApplication(pid), kAXWindowsAttribute) as? [AXUIElement] ?? []).isEmpty {
              if let q = menuItem(pid: pid, key: "Q") { quit = AXUIElementPerformAction(q, kAXPressAction as CFString) == .success }
              break
            }
          }
        }
        print("{\"closed\":1,\"quit\":\(quit)}")
        exit(0)
      }
    }
    Thread.sleep(forTimeInterval: 0.15)
  }
  print("{\"closed\":0}")
  exit(2)
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
  let manual = args.contains("--no-accessibility")
  let trusted = manual || AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
  if manual { log("watching \(bundleId); no permissions: you turn Claude's debugger on") }
  else { log("watching \(bundleId); Accessibility \(trusted ? "allowed" : "NOT allowed yet: System Settings > Privacy & Security > Accessibility > Cinnamon Helper")") }

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
    guard manual || AXIsProcessTrusted() else { log("\(bundleId) started, but Accessibility is not allowed yet; skipping"); return }
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
case "inspect-tabs": reportInspectTabs()
case "close-inspect-tab": closeInspectTab()
case "front": print(NSWorkspace.shared.frontmostApplication.map { String($0.processIdentifier) } ?? ""); exit(0)
default: fail(64, "usage: cinnamon-helper watch|press|inspect-tabs|close-inspect-tab|front|activate")
}
