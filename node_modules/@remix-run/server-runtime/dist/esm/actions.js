/**
 * @remix-run/server-runtime v2.17.4
 *
 * Copyright (c) Remix Software Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.md file in the root directory of this source tree.
 *
 * @license MIT
 */
function throwIfPotentialCSRFAttack(headers) {
  let originHeader = headers.get("origin");
  let originDomain = typeof originHeader === "string" && originHeader !== "null" ? new URL(originHeader).host : originHeader;
  let host = parseHostHeader(headers);
  if (originDomain && (!host || originDomain !== host.value)) {
    if (host) {
      // This seems to be an CSRF attack. We should not proceed with the action.
      throw new Error(`${host.type} header does not match \`origin\` header from a forwarded ` + `action request. Aborting the action.`);
    } else {
      // This is an attack. We should not proceed with the action.
      throw new Error("`x-forwarded-host` or `host` headers are not provided. One of these " + "is needed to compare the `origin` header from a forwarded action " + "request. Aborting the action.");
    }
  }
}
function parseHostHeader(headers) {
  var _forwardedHostHeader$;
  let forwardedHostHeader = headers.get("x-forwarded-host");
  let forwardedHostValue = forwardedHostHeader === null || forwardedHostHeader === void 0 ? void 0 : (_forwardedHostHeader$ = forwardedHostHeader.split(",")[0]) === null || _forwardedHostHeader$ === void 0 ? void 0 : _forwardedHostHeader$.trim();
  let hostHeader = headers.get("host");
  return forwardedHostValue ? {
    type: "x-forwarded-host",
    value: forwardedHostValue
  } : hostHeader ? {
    type: "host",
    value: hostHeader
  } : undefined;
}

export { throwIfPotentialCSRFAttack };
