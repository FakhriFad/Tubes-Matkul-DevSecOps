// ============================================================
// ZAP Authentication Script
// Language: JavaScript (Nashorn engine inside ZAP)
//
// This script logs in to EcomShop and returns a session token
// so ZAP can scan authenticated endpoints (cart, profile, etc.)
//
// To use in ZAP GUI:
//   Scripts → Authentication → Load this file
//   Then configure it in the Context Authentication settings.
// ============================================================

var HttpRequestHeader = Java.type("org.parosproxy.paros.network.HttpRequestHeader");
var HttpHeader        = Java.type("org.parosproxy.paros.network.HttpHeader");
var URI               = Java.type("org.apache.commons.httpclient.URI");

function authenticate(helper, paramsValues, credentials) {
    var loginUrl = paramsValues.get("Login URL");
    var email    = credentials.getParam("email");
    var password = credentials.getParam("password");

    var body = JSON.stringify({ email: email, password: password });

    var requestUri = new URI(loginUrl, false);
    var requestMethod = HttpRequestHeader.POST;

    var requestHeader = new HttpRequestHeader(requestMethod, requestUri, HttpHeader.HTTP11);
    requestHeader.setHeader("Content-Type", "application/json");
    requestHeader.setHeader("Accept",       "application/json");

    var msg = helper.prepareMessage();
    msg.setRequestHeader(requestHeader);
    msg.setRequestBody(body);
    msg.getRequestHeader().setContentLength(msg.getRequestBody().length());

    helper.sendAndReceive(msg, false);

    var response = msg.getResponseBody().toString();
    try {
        var json = JSON.parse(response);
        if (json.token) {
            print("ZAP Auth: Login successful, token obtained");
        } else if (json.mfa_required) {
            print("ZAP Auth: MFA required — use a test account without MFA enabled");
        } else {
            print("ZAP Auth: Unexpected response: " + response.substring(0, 200));
        }
    } catch(e) {
        print("ZAP Auth: Failed to parse login response: " + e);
    }

    return msg;
}

function getRequiredParamsNames() {
    return ["Login URL"];
}

function getOptionalParamsNames() {
    return [];
}

function getCredentialsParamsNames() {
    return ["email", "password"];
}
