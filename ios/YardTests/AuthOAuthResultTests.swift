import XCTest
@testable import Yard

final class AuthOAuthResultTests: XCTestCase {
    private func u(_ s: String) -> URL { URL(string: s)! }

    // MARK: Parsing

    func testParsesFailureWithMessage() {
        let c = AuthOAuthCompletion.parse(u("yard://auth/complete?result=team_account&provider=auth0&message=This%20is%20a%20Yard%20team%20account."))
        XCTAssertEqual(c.result, "team_account")
        XCTAssertEqual(c.provider, "auth0")
        XCTAssertEqual(c.message, "This is a Yard team account.")
    }

    func testParsesPlusAsSpaceAndEncodedPlusAsPlus() {
        let c = AuthOAuthCompletion.parse(u("yard://auth/complete?result=brand_new&provider=google&message=Too+many+sign-in+attempts.+1%2B1"))
        XCTAssertEqual(c.message, "Too many sign-in attempts. 1+1")
        XCTAssertEqual(c.failureMessage, "Too many sign-in attempts. 1+1")
    }

    func testParsesWebsiteCompletionURL() {
        let c = AuthOAuthCompletion.parse(u("https://yardstore.space/auth/complete?result=cancelled&provider=google"))
        XCTAssertEqual(c.result, "cancelled")
        XCTAssertEqual(c.provider, "google")
        XCTAssertNil(c.message)
    }

    func testMissingOrEmptyResultReadsAsError() {
        XCTAssertEqual(AuthOAuthCompletion.parse(u("yard://auth/complete")).result, "error")
        XCTAssertEqual(AuthOAuthCompletion.parse(u("yard://auth/complete?result=&message=")).result, "error")
        XCTAssertNil(AuthOAuthCompletion.parse(u("yard://auth/complete?result=x&message=")).message)
    }

    func testSuccessDropsMessage() {
        let c = AuthOAuthCompletion.parse(u("yard://auth/complete?code=abc&result=signed_in&provider=google&message=Injected"))
        XCTAssertEqual(c.result, "signed_in")
        XCTAssertNil(c.message)
        XCTAssertNil(c.failureMessage)
        XCTAssertNil(AuthOAuthCompletion(result: "reauthed", message: "x").message)
    }

    // MARK: Mapping

    func testNewResultsUseServerCopy() {
        XCTAssertEqual(AuthOAuthResult.message(for: "team_account"),
                       "This is a Yard team account, so it can’t shop. Sign in with a different account.")
        XCTAssertEqual(AuthOAuthResult.message(for: "account_unavailable"),
                       "This Yard account is being deleted or is no longer available. Sign in with a different account.")
        XCTAssertEqual(AuthOAuthResult.message(for: "rate_limited"),
                       "Too many sign-in attempts. Wait a few minutes, then try again.")
    }

    /// Mirrors OAUTH_RESULT_MESSAGES in src/lib/auth/oauth-results.ts.
    func testTableMatchesServer() {
        let server: [String: String] = [
            "cancelled": "Sign-in was cancelled.",
            "invalid_state": "This sign-in link expired or could not be verified. Start again.",
            "error": "The provider couldn’t complete sign-in. Try again.",
            "not_configured": "This sign-in provider isn’t configured on Yard yet.",
            "rate_limited": "Too many sign-in attempts. Wait a few minutes, then try again.",
            "identity_in_use": "That provider account is connected to another Yard account.",
            "already_linked": "That provider is already connected to this account.",
            "link_required": "Sign in with your password before connecting this provider.",
            "email_required": "The provider didn’t share an email address. Try another sign-in method.",
            "email_unverified": "That account’s email address isn’t verified with the provider. Verify it there, or sign in another way.",
            "no_brand": "This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses.",
            "suspended": "This account is currently unavailable.",
            "team_account": "This is a Yard team account, so it can’t shop. Sign in with a different account.",
            "account_unavailable": "This Yard account is being deleted or is no longer available. Sign in with a different account.",
            "reauth_mismatch": "The provider account didn’t match the account being confirmed.",
        ]
        XCTAssertEqual(AuthOAuthResult.messages, server)
    }

    func testKnownResultIgnoresServerMessage() {
        XCTAssertEqual(AuthOAuthResult.message(for: "cancelled", serverMessage: "Something else"), "Sign-in was cancelled.")
    }

    func testUnknownResultShowsTrimmedServerMessage() {
        XCTAssertEqual(AuthOAuthResult.message(for: "brand_new", serverMessage: "  Try again later.\n"), "Try again later.")
        let c = AuthOAuthCompletion.parse(u("yard://auth/complete?result=brand_new&message=%20New%20words.%20"))
        XCTAssertEqual(c.failureMessage, "New words.")
    }

    func testUnknownResultWithoutMessageUsesFallback() {
        XCTAssertEqual(AuthOAuthResult.message(for: "brand_new"), "Sign-in could not be completed.")
        XCTAssertEqual(AuthOAuthResult.message(for: "brand_new", serverMessage: "   "), "Sign-in could not be completed.")
    }

    func testServerMessageIsCappedAndFlattened() {
        let long = String(repeating: "a", count: 1000)
        let shown = AuthOAuthResult.message(for: "brand_new", serverMessage: long)
        XCTAssertEqual(shown.count, AuthOAuthResult.maxServerMessageLength)
        XCTAssertTrue(shown.hasSuffix("…"))
        XCTAssertEqual(AuthOAuthResult.message(for: "brand_new", serverMessage: "Line one\nline\ttwo"), "Line one line two")
    }

    func testSuccessNeverShowsServerMessage() {
        XCTAssertEqual(AuthOAuthResult.message(for: "signed_in", serverMessage: "Injected"), "Sign-in could not be completed.")
    }
}
