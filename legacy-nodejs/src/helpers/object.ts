// copied from https://stackoverflow.com/a/34749873

/**
 * Simple object check.
 * @param item
 * @returns {boolean}
 */
export function isObject(item: any): item is Object {
  return item && typeof item === "object" && !Array.isArray(item);
}

/**
 * Deep merge two objects.
 * @param target
 * @param ...sources
 */
export function mergeDeep(target: Object, ...sources: Object[]) {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      // @ts-expect-error
      if (isObject(source[key])) {
        // @ts-expect-error
        if (!target[key]) Object.assign(target, { [key]: {} });
        // @ts-expect-error
        mergeDeep(target[key], source[key]);
      } else {
        // @ts-expect-error
        Object.assign(target, { [key]: source[key] });
      }
    }
  }

  return mergeDeep(target, ...sources);
}
