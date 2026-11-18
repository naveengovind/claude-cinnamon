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
      // first run (or Cinnamon isn't set up), or opened with --setup: walk the person through it
      if model.cliMissing || !model.isSetUp || args.contains("--setup") { Windows.showSetup() }
    }
  }
}

/**
 * `Cinnamon --snapshot <folder>`: pictures of the menu panel and the Setup window, drawn by the app itself (no Screen
 * Recording permission), for the docs. Writes menu.png and setup.png, then quits.
 */
@MainActor
enum Snapshot {
  static func take(to folder: URL) async {
    let model = AppModel.shared
    await model.refreshDoctor()
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let menu = window(MenuView(), width: 320, height: nil)
    let setup = window(SetupView(), width: 560, height: 900)
    try? await Task.sleep(nanoseconds: 1_500_000_000) // let both lay out and draw
    write(menu, to: folder.appendingPathComponent("menu.png"))
    write(setup, to: folder.appendingPathComponent("setup.png"))
    menu.close()
    setup.close()
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

  static func showLog(_ text: String) {
    open["log"]?.close()
    show("log", title: "Cinnamon Log", size: NSSize(width: 640, height: 420)) {
      ScrollView { Text(text).font(.system(.caption, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
    }
  }
}
