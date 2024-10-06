const {
  isArray,
  isFunction,
  isObject,
  isUndefined,
  randomHash,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require("utils");

interface Skippable {
  __skip__?: boolean;
}

interface HiddenGetterProperties {
  __getter__?: () => unknown;
  __setter__?: StateSetter<unknown>;
}

interface HiddenHandlerProperties {
  __handler__?: () => void;
  __states__?: Record<string, boolean>;
}

type Primitive = string | number | boolean | null | undefined;
type AnyObject = Record<string | symbol, unknown>;

type WithHiddenGetterProperties<T> = T & HiddenGetterProperties;
type AnyObjectWithHiddenGetterProperties<T> = {
  [K in keyof T]: WithHiddenGetterProperties<T[K]> & Skippable;
} & HiddenGetterProperties;

type StateValue<T> = T | Primitive;
type StateGetter<T> = (() => T) & HiddenGetterProperties;
type StateSetter<T> = (newValue: T | ((prev: T) => T), merge?: boolean) => void;
type StateHandler = (() => void) & HiddenHandlerProperties & Skippable;

const MERGE = "__mergeValue__";
const UNSET = "__unsetValue__";
const SKIP = "__skip__";

const getValue = <T>(value: StateValue<T>): T => {
  const getter = (value as WithHiddenGetterProperties<T>).__getter__;
  return getter ? (getter() as T) : (value as T);
};

const setValue = <T>(
  currentValue: StateValue<T>,
  newValue: StateValue<T> | ((prev: T) => T),
  merge = false,
): StateValue<T> => {
  let value: StateValue<T>;

  if (isFunction(newValue)) {
    (newValue as Skippable).__skip__ = true;
    if (isObject(currentValue)) {
      const prev = new Proxy(() => undefined, {
        apply: (_target, _this, [newObject]: [unknown]): unknown =>
          newObject ? { [MERGE]: newObject } : currentValue,
        get: (_, property: string | symbol): unknown =>
          (currentValue as AnyObject)[property as keyof typeof currentValue],
      });
      value = (newValue as (prev: T) => T)(prev as T);
    } else {
      value = (newValue as (prev: T) => T)(currentValue as T);
    }
  } else {
    value = newValue as StateValue<T>;
  }

  if (isObject(value) && isObject(currentValue)) {
    const deepMerge = (value as AnyObject)[MERGE];
    updateState(
      currentValue as AnyObject,
      deepMerge || (value as AnyObject),
      merge || !!deepMerge,
    );
    return currentValue;
  }

  return value;
};

const updateState = <T extends object>(
  currentObject: T,
  newObject: Partial<T>,
  merge: boolean,
): void => {
  const keys: Record<string, boolean> = {};

  Object.entries(newObject).forEach(([key, value]) => {
    const setter = (currentObject as AnyObjectWithHiddenGetterProperties<T>)[
      key as keyof T
    ]?.__setter__;

    if (setter) {
      setter(value as T[keyof T], merge);
    } else {
      (currentObject as AnyObject)[key] = value;
    }

    keys[key] = true;
  });

  if (!merge) {
    Object.keys(currentObject).forEach((key) => {
      if (key !== SKIP && !keys[key]) {
        const isPlainFunction =
          (currentObject as AnyObjectWithHiddenGetterProperties<T>)[
            key as keyof T
          ]?.__skip__ &&
          !(currentObject as AnyObjectWithHiddenGetterProperties<T>)[
            key as keyof T
          ]?.__getter__;

        if (!isPlainFunction) {
          const setter = (
            currentObject as AnyObjectWithHiddenGetterProperties<T>
          )[key as keyof T]?.__setter__;

          if (setter) {
            setter(UNSET as unknown as T[keyof T]);
          } else {
            (currentObject as AnyObject)[key] = undefined;
          }
        }
      }
    });
  }
};

const useState = <T>(
  initialValue: T | (() => T),
  handler?: StateHandler,
): [StateGetter<T>, StateSetter<T>] => {
  if (isFunction(initialValue)) {
    (initialValue as Skippable).__skip__ = true;
    return [initialValue as StateGetter<T>, (): void => {}];
  }

  let state: StateValue<T> = initialValue as T;
  const hash = randomHash();
  const handlers: StateHandler[] = [];

  const register = (caller: () => void): void => {
    if (
      !caller ||
      caller === handler ||
      caller.name === SKIP ||
      (caller as Skippable).__skip__ ||
      (caller as StateHandler).__states__?.[hash]
    ) {
      return;
    }

    const callerWithStates: StateHandler = caller as () => void;
    callerWithStates.__states__ ??= {};
    callerWithStates.__states__[hash] = true;
    handlers.push(callerWithStates);
  };

  const getter: StateGetter<T> = new Proxy(() => undefined, {
    apply: function __skip__(): T {
      register(arguments.callee.caller as StateHandler);
      if (isObject(state)) {
        const object = isArray(state) ? [] : {};
        Object.keys(state as AnyObject).forEach((key) => {
          (object as AnyObject)[key] = getValue((state as AnyObject)[key]);
        });
        return object as T;
      }
      return state as T;
    },
    get: function __skip__(_target, property: string | symbol): unknown {
      if (property === "__getter__") return () => state;
      if (property === "__setter__") return setter;
      if (isUndefined(state)) return undefined;

      if (Object.prototype.hasOwnProperty.call(state, property)) {
        register(arguments.callee.caller as StateHandler);
        const [getter] = useState((state as AnyObject)[property], handler);
        (state as AnyObject)[property] = getter;
      }

      return (state as AnyObject)[property];
    },
  }) as StateGetter<T>;

  const setter: StateSetter<T> = (
    newValue: T | ((prev: T) => T),
    merge = false,
  ): void => {
    const unset = newValue === UNSET;

    if (unset && isObject(state)) {
      Object.entries(state as AnyObject).forEach(([key, value]) => {
        if (!Object.prototype.hasOwnProperty.call(state, key)) {
          (value as WithHiddenGetterProperties<unknown>).__setter__?.(UNSET);
        }
      });
    }

    state = unset ? undefined : setValue(state, newValue, merge);
    handlers.forEach((handler) => (handler.__handler__ ?? handler)());

    if (unset) {
      handlers.length = 0;
    }
  };

  return [getter, setter];
};

const useStateWithCaller = function <T>(
  initialValue: T | (() => T),
  handler?: StateHandler,
): [StateGetter<T>, StateSetter<T>] {
  return useState(
    initialValue,
    handler ?? (arguments.callee.caller as StateHandler),
  );
};

exports.useState = useStateWithCaller;