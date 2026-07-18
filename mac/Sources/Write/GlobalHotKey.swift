import Carbon.HIToolbox
import Foundation

enum GlobalHotKeyError: LocalizedError {
    case install(OSStatus)
    case register(OSStatus)

    var errorDescription: String? {
        switch self {
        case .install(let status):
            return "Could not install the hotkey handler (\(status))"
        case .register(let status):
            return "Could not register the hotkey (\(status))"
        }
    }
}

/// A Carbon hotkey works while any app is frontmost and requires neither an
/// Accessibility permission nor an event tap.
final class GlobalHotKey {
    private static let signature: OSType = 0x57524954 // WRIT
    private var eventHandler: EventHandlerRef?
    private var hotKey: EventHotKeyRef?
    private let action: () -> Void

    init(
        keyCode: UInt32 = UInt32(kVK_Space),
        modifiers: UInt32 = UInt32(cmdKey | shiftKey),
        action: @escaping () -> Void
    ) throws {
        self.action = action
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, _, userData in
                guard let userData else { return OSStatus(eventNotHandledErr) }
                let owner = Unmanaged<GlobalHotKey>.fromOpaque(userData)
                    .takeUnretainedValue()
                owner.action()
                return noErr
            },
            1,
            &eventType,
            Unmanaged.passUnretained(self).toOpaque(),
            &eventHandler
        )
        guard installStatus == noErr else {
            throw GlobalHotKeyError.install(installStatus)
        }

        let identifier = EventHotKeyID(signature: Self.signature, id: 1)
        let registerStatus = RegisterEventHotKey(
            keyCode,
            modifiers,
            identifier,
            GetApplicationEventTarget(),
            0,
            &hotKey
        )
        guard registerStatus == noErr else {
            if let eventHandler { RemoveEventHandler(eventHandler) }
            self.eventHandler = nil
            throw GlobalHotKeyError.register(registerStatus)
        }
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let eventHandler { RemoveEventHandler(eventHandler) }
        hotKey = nil
        eventHandler = nil
    }

    deinit { unregister() }
}
