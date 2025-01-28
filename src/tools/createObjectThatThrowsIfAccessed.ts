const keyIsTrapped = "isTrapped_zSskDe9d";

export class AccessError extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export function createObjectThatThrowsIfAccessed<T extends object>(params?: {
    debugMessage?: string;
    isPropertyWhitelisted?: (prop: string | number | symbol) => boolean;
}): T {
    const { debugMessage = "", isPropertyWhitelisted = () => false } = params ?? {};

    const get: NonNullable<ProxyHandler<T>["get"]> = (...args) => {
        const [, prop] = args;

        if (isPropertyWhitelisted(prop)) {
            return Reflect.get(...args);
        }

        if (prop === keyIsTrapped) {
            return true;
        }

        throw new AccessError(`Cannot access ${String(prop)} yet ${debugMessage}`);
    };

    const trappedObject = new Proxy<T>({} as any, {
        get,
        set: get
    });

    return trappedObject;
}

export function isObjectThatThrowIfAccessed(obj: object) {
    return (obj as any)[keyIsTrapped] === true;
}
