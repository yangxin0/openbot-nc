export type Listener<T> = (value: T) => void;

export interface MockRuntime {
  emit: <T>(listeners: Set<Listener<T>>, value: T) => void;
  schedule: (callback: () => void, delay?: number) => void;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
