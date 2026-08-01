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
    private static var nextIdentifier: UInt32 = 1
    private var eventHandler: EventHandlerRef?
    private var hotKey: EventHotKeyRef?
    private let identifier: EventHotKeyID
    private let action: () -> Void

    init(
        keyCode: UInt32 = UInt32(kVK_Space),
        modifiers: UInt32 = UInt32(cmdKey | shiftKey),
        action: @escaping () -> Void
    ) throws {
        identifier = EventHotKeyID(
            signature: Self.signature, id: Self.nextIdentifier)
        Self.nextIdentifier &+= 1
        self.action = action
        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let installStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let event, let userData else {
                    return OSStatus(eventNotHandledErr)
                }
                let owner = Unmanaged<GlobalHotKey>.fromOpaque(userData)
                    .takeUnretainedValue()
                var received = EventHotKeyID()
                let parameterStatus = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &received
                )
                guard parameterStatus == noErr,
                      received.signature == owner.identifier.signature,
                      received.id == owner.identifier.id else {
                    return OSStatus(eventNotHandledErr)
                }
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
