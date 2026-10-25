import AppKit
import ApplicationServices

struct Node: Encodable {
    let id: String
    let role: String
    let name: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let path: [Int]
}

struct Snapshot: Encodable {
    let app: String
    let pid: Int32
    let windows: Int
    let visited: Int
    let ms: Int
    let candidates: [Node]
}

struct Outcome: Encodable {
    let ok: Bool
    let detail: String
}

let interactiveRoles: Set<String> = [
    "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXSearchField", "AXCheckBox", "AXRadioButton",
    "AXPopUpButton", "AXComboBox", "AXMenuItem", "AXMenuButton", "AXTab", "AXSlider", "AXIncrementor",
    "AXDisclosureTriangle", "AXSwitch",
]

func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value as? T
}

func frame(_ element: AXUIElement) -> CGRect? {
    guard let positionValue: AXValue = attribute(element, kAXPositionAttribute),
          let sizeValue: AXValue = attribute(element, kAXSizeAttribute) else { return nil }
    var origin = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(positionValue, .cgPoint, &origin)
    AXValueGetValue(sizeValue, .cgSize, &size)
    return CGRect(origin: origin, size: size)
}

func label(_ element: AXUIElement) -> String {
    for key in [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, kAXPlaceholderValueAttribute as String] {
        if let text: String = attribute(element, key), !text.isEmpty { return text }
    }
    if let value: String = attribute(element, kAXValueAttribute), !value.isEmpty, value.count < 80 { return value }
    return ""
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute) ?? []
}

func application(named name: String?) -> NSRunningApplication? {
    guard let name, name != "-" else { return NSWorkspace.shared.frontmostApplication }
    return NSWorkspace.shared.runningApplications.first { $0.localizedName == name }
}

func roots(of app: NSRunningApplication) -> [AXUIElement] {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    let windows: [AXUIElement] = attribute(root, kAXWindowsAttribute) ?? []
    let menuBar: AXUIElement? = attribute(root, kAXMenuBarAttribute)
    return windows + (menuBar.map { [$0] } ?? [])
}

func snapshot(_ app: NSRunningApplication, onlyFront: Bool) -> Snapshot {
    let started = Date()
    var nodes: [Node] = []
    var visited = 0
    func walk(_ element: AXUIElement, path: [Int]) {
        visited += 1
        guard path.count < 40, visited < 20000 else { return }
        let role: String = attribute(element, kAXRoleAttribute) ?? ""
        if interactiveRoles.contains(role), let box = frame(element), box.width > 1, box.height > 1 {
            nodes.append(Node(id: "e\(nodes.count + 1)", role: role, name: label(element), x: box.minX, y: box.minY, w: box.width, h: box.height, path: path))
        }
        for (index, child) in children(element).enumerated() { walk(child, path: path + [index]) }
    }
    let windows = roots(of: app)
    let front = frontWindowIndex(app)
    for (index, root) in windows.enumerated() where onlyFront == false || index == front || index == windows.count - 1 {
        walk(root, path: [index])
    }
    return Snapshot(app: app.localizedName ?? "?", pid: app.processIdentifier, windows: windows.count, visited: visited, ms: Int(Date().timeIntervalSince(started) * 1000), candidates: nodes)
}

func resolve(_ app: NSRunningApplication, path: [Int]) -> AXUIElement? {
    guard let first = path.first else { return nil }
    let all = roots(of: app)
    guard first < all.count else { return nil }
    var element = all[first]
    for index in path.dropFirst() {
        let kids = children(element)
        guard index < kids.count else { return nil }
        element = kids[index]
    }
    return element
}

func press(_ element: AXUIElement) -> Outcome {
    let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
    return Outcome(ok: result == .success, detail: "AXPress \(result.rawValue)")
}

func setValue(_ element: AXUIElement, _ text: String) -> Outcome {
    AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString)
    let readBack: String = attribute(element, kAXValueAttribute) ?? ""
    return Outcome(ok: result == .success && readBack == text, detail: "AXValue \(result.rawValue), read back \(readBack == text ? "matches" : "differs")")
}

func clickAt(x: Double, y: Double) -> Outcome {
    let point = CGPoint(x: x, y: y)
    let source = CGEventSource(stateID: .hidSystemState)
    for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
        CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(30000)
    }
    return Outcome(ok: true, detail: "clicked \(Int(x)),\(Int(y))")
}

let keyCodes: [String: CGKeyCode] = ["return": 36, "tab": 48, "escape": 53, "space": 49, "down": 125, "up": 126]

func pressKey(_ name: String, to app: NSRunningApplication) -> Outcome {
    guard let code = keyCodes[name] else { return Outcome(ok: false, detail: "unknown key \(name)") }
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
        return Outcome(ok: false, detail: "refused: \(app.localizedName ?? "?") is not the frontmost app")
    }
    let source = CGEventSource(stateID: .hidSystemState)
    let pid = app.processIdentifier
    CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true)?.postToPid(pid)
    usleep(20000)
    CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false)?.postToPid(pid)
    return Outcome(ok: true, detail: "key \(name) to pid \(pid)")
}

func typeText(_ text: String, to app: NSRunningApplication) -> Outcome {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
        return Outcome(ok: false, detail: "refused: \(app.localizedName ?? "?") is not the frontmost app")
    }
    let source = CGEventSource(stateID: .hidSystemState)
    let pid = app.processIdentifier
    for scalar in text.utf16 {
        var unit = scalar
        for down in [true, false] {
            let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down)
            event?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &unit)
            event?.postToPid(pid)
            usleep(8000)
        }
    }
    return Outcome(ok: true, detail: "typed \(text.count) characters to pid \(pid)")
}

func focus(_ element: AXUIElement) -> Outcome {
    let result = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(100000)
    let length = (attribute(element, kAXValueAttribute) as String?)?.utf16.count ?? 0
    var everything = CFRange(location: 0, length: length)
    let selected = AXValueCreate(.cfRange, &everything).map { AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, $0) }
    return Outcome(ok: result == .success, detail: "AXFocused \(result.rawValue), selected \(length) chars \(selected?.rawValue ?? -1)")
}

func frontWindowIndex(_ app: NSRunningApplication) -> Int? {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    let windows: [AXUIElement] = attribute(root, kAXWindowsAttribute) ?? []
    guard let focused: AXUIElement = attribute(root, kAXFocusedWindowAttribute) else { return windows.isEmpty ? nil : 0 }
    return windows.firstIndex { CFEqual($0, focused) }
}

func confirm(_ element: AXUIElement) -> Outcome {
    let result = AXUIElementPerformAction(element, kAXConfirmAction as CFString)
    return Outcome(ok: result == .success, detail: "AXConfirm \(result.rawValue)")
}

func emit<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    FileHandle.standardOutput.write(try! encoder.encode(value))
}

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
    exit(code)
}

guard AXIsProcessTrusted() else { fail("Accessibility permission is not granted for this process.", code: 2) }

let args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else { fail("usage: ax snapshot|press|set|click|activate|apps ...", code: 64) }
let parsePath = { (text: String) in text.split(separator: ".").compactMap { Int($0) } }

switch command {
case "apps":
    let apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.compactMap(\.localizedName)
    emit(apps)
case "snapshot":
    guard let app = application(named: args.dropFirst().first) else { fail("app not found", code: 3) }
    emit(snapshot(app, onlyFront: !args.contains("--all-windows")))
case "type":
    guard args.count >= 3, let app = application(named: args[1]) else { fail("usage: ax type <app> <text>", code: 64) }
    emit(typeText(args[2], to: app))
case "focus":
    guard args.count >= 3, let app = application(named: args[1]) else { fail("usage: ax focus <app> <path>", code: 64) }
    guard let element = resolve(app, path: parsePath(args[2])) else { fail("element not found at \(args[2])", code: 4) }
    emit(focus(element))
case "activate":
    guard let app = application(named: args.dropFirst().first) else { fail("app not found", code: 3) }
    emit(Outcome(ok: app.activate(), detail: "activate \(app.localizedName ?? "?")"))
case "press", "set":
    guard args.count >= 3, let app = application(named: args[1]) else { fail("usage: ax \(command) <app> <path> [text]", code: 64) }
    guard let element = resolve(app, path: parsePath(args[2])) else { fail("element not found at \(args[2])", code: 4) }
    emit(command == "press" ? press(element) : setValue(element, args.count > 3 ? args[3] : ""))
case "key":
    guard args.count >= 3, let app = application(named: args[1]) else { fail("usage: ax key <app> <return|tab|escape|space|down|up>", code: 64) }
    emit(pressKey(args[2], to: app))
case "confirm":
    guard args.count >= 3, let app = application(named: args[1]) else { fail("usage: ax confirm <app> <path>", code: 64) }
    guard let element = resolve(app, path: parsePath(args[2])) else { fail("element not found at \(args[2])", code: 4) }
    emit(confirm(element))
case "click":
    guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else { fail("usage: ax click <x> <y>", code: 64) }
    emit(clickAt(x: x, y: y))
default:
    fail("unknown command \(command)", code: 64)
}
