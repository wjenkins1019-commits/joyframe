import type { JSX as ReactJSX } from 'react'

declare global {
  namespace React {
    namespace JSX {
      type Element = ReactJSX.Element
      interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
      interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
      interface ElementClass extends ReactJSX.ElementClass {}
    }
  }
}

export {}
