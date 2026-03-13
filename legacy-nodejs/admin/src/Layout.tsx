import React from "react";
import { Layout } from "react-admin";
import { ReactQueryDevtools } from "react-query/devtools";

export function CustomLayout(props) {
  return (
    <>
      <Layout {...props} />
      <ReactQueryDevtools initialIsOpen={false} />
    </>
  );
}
