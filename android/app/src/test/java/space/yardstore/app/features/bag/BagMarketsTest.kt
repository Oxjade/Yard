package space.yardstore.app.features.bag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BagMarketsTest {
    private val ng = BagMarkets.country("NG")
    private val gb = BagMarkets.country("GB")
    private val de = BagMarkets.country("DE")

    @Test fun countryLookupFallsBackToNigeria() {
        assertEquals("Ghana", BagMarkets.country("gh").name)
        assertEquals("Nigeria", BagMarkets.country("XX").name)
        assertTrue(BagMarkets.isSupported("kr"))
        assertFalse(BagMarkets.isSupported("BR"))
        assertEquals(11, BagMarkets.countries.size)
    }

    @Test fun parsePhoneNormalisesNationalAndInternational() {
        assertEquals("+234 8031234567", BagMarkets.parsePhone("0803 123 4567", ng))
        assertEquals("+234 8031234567", BagMarkets.parsePhone("+234 803-123-4567", ng))
        assertEquals("+234 8031234567", BagMarkets.parsePhone("002348031234567", ng))
        assertEquals("+447700900123", BagMarkets.parsePhone("+44 7700 900123", ng)) // another country's number, kept whole
        assertEquals("+44 7700900123", BagMarkets.parsePhone("07700 900123", gb))
        assertEquals("+49 15123456789", BagMarkets.parsePhone("01512 3456789", de))
    }

    @Test fun parsePhoneRejectsWrongLengthsAndLetters() {
        assertNull(BagMarkets.parsePhone("0803 123", ng))
        assertNull(BagMarkets.parsePhone("0803abc4567", ng))
        assertNull(BagMarkets.parsePhone("", ng))
        assertNull(BagMarkets.parsePhone("+12345", ng))
    }

    @Test fun cityLineSkipsDuplicateRegion() {
        assertEquals("Ikeja, Lagos", BagMarkets.cityLine(" Ikeja ", "Lagos"))
        assertEquals("lagos", BagMarkets.cityLine("lagos", "Lagos"))
        assertEquals("Accra", BagMarkets.cityLine("Accra", " "))
    }

    @Test fun postcodePatternsAreCaseInsensitive() {
        assertTrue(BagMarkets.postcodeMatches("e8 4dg", gb))
        assertFalse(BagMarkets.postcodeMatches("E84", gb))
        assertTrue(BagMarkets.postcodeMatches("101245", ng))
        assertTrue(BagMarkets.postcodeMatches("ga-183-8164", BagMarkets.country("GH")))
        assertTrue(BagMarkets.postcodeMatches("10001-1234", BagMarkets.country("US")))
    }

    @Test fun chargeCurrencyFollowsRulesTs() {
        assertEquals("USD", BagMarkets.chargeCurrency("usd", ng, listOf("NGN", "USD")))
        assertEquals("NGN", BagMarkets.chargeCurrency("EUR", ng, listOf("NGN", "USD")))
        assertEquals("GHS", BagMarkets.chargeCurrency("EUR", BagMarkets.country("GH"), listOf("NGN", "GHS")))
        assertEquals("NGN", BagMarkets.chargeCurrency("EUR", gb, listOf("ngn", "usd")))
        assertEquals("USD", BagMarkets.chargeCurrency("EUR", gb, listOf("USD", "KES")))
        assertEquals("NGN", BagMarkets.chargeCurrency("EUR", gb, emptyList()))
    }

    @Test fun paymentMethodsPerProviderCountryAndCurrency() {
        assertEquals(listOf(BagPaymentMethod.Card, BagPaymentMethod.BankTransfer, BagPaymentMethod.Ussd), BagMarkets.paymentMethods("NG", "NGN", "paystack"))
        assertEquals(listOf(BagPaymentMethod.Card), BagMarkets.paymentMethods("NG", "USD", "paystack"))
        assertEquals(listOf(BagPaymentMethod.Card, BagPaymentMethod.MobileMoney), BagMarkets.paymentMethods("KE", "KES", "paystack"))
        assertEquals(listOf(BagPaymentMethod.Card, BagPaymentMethod.BankTransfer), BagMarkets.paymentMethods("GB", "NGN", "bachs"))
        assertEquals(listOf(BagPaymentMethod.MobileMoney), BagMarkets.paymentMethods("GH", "GHS", "bachs"))
        assertEquals("Bachs", BagMarkets.providerName("bachs"))
        assertEquals("Paystack", BagMarkets.providerName("stub"))
    }

    @Test fun paymentMethodCopy() {
        assertEquals("Instant EFT", BagPaymentMethod.BankTransfer.title("ZA"))
        assertEquals("M-Pesa or Airtel Money", BagPaymentMethod.MobileMoney.title("KE"))
        assertEquals("Visa, Mastercard and Verve", BagPaymentMethod.Card.detail("NG"))
        assertTrue(BagPaymentMethod.BankTransfer.next("ZA", "Paystack").startsWith("Paystack takes you to your bank"))
        assertTrue(BagPaymentMethod.BankTransfer.next("NG", "Bachs").startsWith("Bachs shows a one-time account number"))
        assertEquals("bank_transfer", BagPaymentMethod.BankTransfer.rawValue)
    }

    @Test fun arrivalRanges() {
        assertEquals("11–16 Nov", BagMarkets.arrivalRange("2026-11-11", "2026-11-16"))
        assertEquals("30 Nov – 2 Dec", BagMarkets.arrivalRange("2026-11-30", "2026-12-02"))
        assertEquals("11 Nov", BagMarkets.arrivalRange("2026-11-11", "2026-11-11"))
        assertNull(BagMarkets.arrivalRange("2026-11-11", null))
        assertNull(BagMarkets.arrivalRange("soon", "later"))
    }
}
