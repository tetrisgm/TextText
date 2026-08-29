import Foundation

public enum CLIArgumentError: Error, Equatable, CustomStringConvertible {
    case missingValue(String)
    case unknownOption(String)
    case messageRequiresActor

    public var description: String {
        switch self {
        case .missingValue(let option): return "\(option) needs a value"
        case .unknownOption(let option): return "unknown option \(option)"
        case .messageRequiresActor: return "--message requires --as NAME"
        }
    }
}

public struct CLICommandLineOptions: Equatable {
    public var command = ""
    public var positional: [String] = []
    public var section: String?
    public var from: String?
    public var actor: String?
    public var message: String?
    public var idempotencyKey: String?
    public var ifMatchHash: String?
    public var folder: String?
    /// JSON arguments for `texttext do`, where a command's shape is its own.
    public var args: String?
    public var json = false

    public init() {}

    public static func parse(_ arguments: [String]) throws -> Self {
        var options = Self()
        var rest = arguments
        if let first = rest.first, !first.hasPrefix("-") {
            options.command = first
            rest.removeFirst()
        }

        var index = 0
        while index < rest.count {
            let argument = rest[index]
            func value() throws -> String {
                index += 1
                guard index < rest.count else {
                    throw CLIArgumentError.missingValue(argument)
                }
                return rest[index]
            }
            switch argument {
            case "--section", "-s": options.section = try value()
            case "--from", "-f": options.from = try value()
            case "--as": options.actor = try value()
            case "--message", "-m": options.message = try value()
            case "--idempotency-key": options.idempotencyKey = try value()
            case "--if-match-hash": options.ifMatchHash = try value()
            case "--folder": options.folder = try value()
            case "--args": options.args = try value()
            case "--json": options.json = true
            case "--help", "-h": options.command = "help"
            default:
                if argument.hasPrefix("-") {
                    throw CLIArgumentError.unknownOption(argument)
                }
                options.positional.append(argument)
            }
            index += 1
        }

        if options.message != nil && options.actor == nil {
            throw CLIArgumentError.messageRequiresActor
        }
        return options
    }
}
