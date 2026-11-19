// Cinnamon: a menu bar app for Cinnamon (themes and extensions for the Claude desktop app). A front end to the
// `cinnamon` command: pick a color scheme, switch extensions, apply, take a screenshot, add themes and extensions
// from GitHub, update, and a Setup window that walks a person through everything Cinnamon needs.
// Built by `cinnamon app install` (core/install/AppInstaller.ts) or the release script; macOS 13 or later.
import AppKit
import SwiftUI

@main
struct CinnamonApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
  @StateObject private var model = AppModel.shared

  var body: some Scene {
    MenuBarExtra {
      MenuView()
        .environmentObject(model)
    } label: {
      Image(systemName: "paintpalette")
    }
    .menuBarExtraStyle(.window)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    Task { @MainActor in
      let model = AppModel.shared
      await model.refresh()
      let args = CommandLine.arguments
      if let i = args.firstIndex(of: "--snapshot"), i + 1 < args.count {
        await Snapshot.take(to: URL(fileURLWithPath: args[i + 1]))
        NSApp.terminate(nil)
        return
      }
      TurnOnPrompt.shared.start() // guided mode: asks for the menu click each time Claude starts
      // first run (or Cinnamon isn't set up), or opened with --setup: walk the person through it
      if model.cliMissing || !model.isSetUp || args.contains("--setup") { Windows.showSetup() }
    }
  }
}

/**
 * `Cinnamon --snapshot <folder>`: pictures of the menu panel and the Setup window, drawn by the app itself (no Screen
 * Recording permission), for the docs. Writes menu.png, setup.png, browsers.png, turn-on.png (guided mode's card) and browser-steps.png (the steps
 * shown after setting up the first browser on this Mac; nothing is set up for it), then quits.
 */
@MainActor
enum Snapshot {
  static func take(to folder: URL) async {
    let model = AppModel.shared
    await model.refreshDoctor()
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    await model.refreshBrowsers()
    let menu = window(MenuView(), width: 320, height: nil)
    let setup = window(SetupView(), width: 560, height: 1300)
    let browsers = window(BrowserWindowView(), width: 520, height: 420)
    try? await Task.sleep(nanoseconds: 1_500_000_000) // let them lay out and draw
    write(menu, to: folder.appendingPathComponent("menu.png"))
    write(setup, to: folder.appendingPathComponent("setup.png"))
    write(browsers, to: folder.appendingPathComponent("browsers.png"))
    let card = window(TurnOnCard(), width: 360, height: nil)
    try? await Task.sleep(nanoseconds: 500_000_000)
    write(card, to: folder.appendingPathComponent("turn-on.png"))
    card.close()
    if let b = model.browsers?.installed.first {
      model.browserSteps = BrowserSteps(browser: b, folder: model.browsers?.extensionDir ?? "")
      browsers.setContentSize(NSSize(width: 520, height: 760))
      try? await Task.sleep(nanoseconds: 1_000_000_000)
      write(browsers, to: folder.appendingPathComponent("browser-steps.png"))
      model.browserSteps = nil
    }
    for w in [menu, setup, browsers] { w.close() }
  }

  /** `height` nil: as tall as the view wants (the menu); a scrolling view gets a fixed one. */
  private static func window<V: View>(_ view: V, width: CGFloat, height: CGFloat?) -> NSWindow {
    // drawn on the window's own color: a picture has no window behind it (white text would vanish in dark mode)
    let host = NSHostingView(rootView: view.environmentObject(AppModel.shared).background(Color(nsColor: .windowBackgroundColor)))
    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height ?? max(host.fittingSize.height, 200)), styleMask: [.borderless], backing: .buffered, defer: false)
    w.identifier = NSUserInterfaceItemIdentifier(height == nil ? "fit" : "fixed")
    w.isReleasedWhenClosed = false
    w.contentView = host
    w.backgroundColor = .windowBackgroundColor
    w.alphaValue = 0.01 // drawn, but not something a person sees flash by
    w.orderFrontRegardless()
    return w
  }

  private static func write(_ w: NSWindow, to url: URL) {
    guard let view = w.contentView else { return }
    if w.identifier?.rawValue == "fit" {
      let fit = view.fittingSize
      if fit.height > 0 { w.setContentSize(NSSize(width: w.frame.width, height: fit.height)) }
    }
    view.layoutSubtreeIfNeeded()
    guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
    view.cacheDisplay(in: view.bounds, to: rep)
    try? rep.representation(using: .png, properties: [:])?.write(to: url)
  }
}

/** The app's windows: plain AppKit windows hosting SwiftUI, so they open from anywhere (the first launch too). */
@MainActor
enum Windows {
  private static var open: [String: NSWindow] = [:]

  static func show<V: View>(_ id: String, title: String, size: NSSize, @ViewBuilder content: () -> V) {
    if let w = open[id] {
      w.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      return
    }
    let w = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    w.title = title
    w.isReleasedWhenClosed = false
    w.contentView = NSHostingView(rootView: content().environmentObject(AppModel.shared))
    w.center()
    NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: w, queue: .main) { _ in
      Task { @MainActor in open[id] = nil }
    }
    open[id] = w
    w.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  static func showSetup() {
    show("setup", title: "Cinnamon Setup", size: NSSize(width: 560, height: 640)) { SetupView() }
  }

  static func showGetMore() {
    show("get-more", title: "Get More Themes and Extensions", size: NSSize(width: 520, height: 420)) { GetMoreView() }
  }

  /** With `finishing`, opens on that browser's walkthrough. */
  static func showBrowsers(finishing id: String? = nil) {
    show("browsers", title: "Claude in Your Browser", size: NSSize(width: 520, height: 680)) { BrowserWindowView() }
    guard let id else { return }
    Task { @MainActor in
      let model = AppModel.shared
      await model.refreshBrowsers()
      if let b = model.browsers?.browsers.first(where: { $0.id == id }) {
        model.browserSteps = BrowserSteps(browser: b, folder: model.browsers?.extensionDir ?? "", openedPage: false)
      }
    }
  }

  static func showLog(_ text: String) {
    open["log"]?.close()
    open["log"] = nil // close() only clears it on a later pass; don't bring the closed window back
    show("log", title: "Cinnamon Log", size: NSSize(width: 640, height: 420)) {
      ScrollView { Text(text).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
    }
  }
}
