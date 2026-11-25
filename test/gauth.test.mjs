import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl, parseResult, redirectUri } from "../src/lib/gauth.js";

test("auth URL asks for a token, only the given scope, with state and our redirect", () => {
  const u = new URL(authUrl({ clientId: "1-x.apps.googleusercontent.com", scope: "S", state: "abc", redirect: "https://h/cofre/oauth.html" }));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("response_type"), "token");
  assert.equal(u.searchParams.get("scope"), "S");
  assert.equal(u.searchParams.get("state"), "abc");
  assert.equal(u.searchParams.get("redirect_uri"), "https://h/cofre/oauth.html");
});

test("redirect is oauth.html next to the app, without hash or query", () => {
  assert.equal(redirectUri("https://h/cofre/?x=1#a"), "https://h/cofre/oauth.html");
  assert.equal(redirectUri("https://h/cofre/index.html"), "https://h/cofre/oauth.html");
});

test("the answer is taken only with our state; errors are explained", () => {
  assert.equal(parseResult("access_token=T&state=s1&expires_in=3599", "s1"), "T");
  assert.equal(parseResult("#access_token=T&state=old", "s1"), null);
  assert.throws(() => parseResult("error=access_denied&state=s1", "s1"), (e) => e.denied === true);
  assert.throws(() => parseResult("state=s1", "s1"));
});
