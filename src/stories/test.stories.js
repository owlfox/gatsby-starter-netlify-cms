import React from "react"
import { storiesOf } from "@storybook/react"

storiesOf(`Dashboard/Header`, module).add(`default`, () => (
  <div style={{ padding: `16px`, backgroundColor: `#eeeeee` }}>
    <h1 style={{ color: "rebeccapurple" }}>Hello from Storybook and Gatsby!</h1>
  </div>
))