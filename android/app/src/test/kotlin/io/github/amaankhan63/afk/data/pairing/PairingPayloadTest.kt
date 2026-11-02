package io.github.amaankhan63.afk.data.pairing

import io.github.amaankhan63.afk.data.connection.Endpoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingPayloadTest {
    @Test fun parsesFullPayload() = assertEquals(
        PairingPayload("100.84.12.9", 2350, "abc"),
        PairingCodec.parse("""{"afk":1,"host":"100.84.12.9","port":2350,"token":"abc"}""")
            .getOrThrow()
    )

    @Test fun portDefaultsTo2350() = assertEquals(
        2350,
        PairingCodec.parse("""{"afk":1,"host":"h","token":"t"}""").getOrThrow().port
    )

    @Test fun trimsHostAndToken() = assertEquals(
        PairingPayload("100.84.12.9", 2350, "abc"),
        PairingCodec.parse("""{"afk":1,"host":" 100.84.12.9 ","token":" abc\n"}""").getOrThrow()
    )

    @Test fun ignoresUnknownFields() = assertEquals(
        PairingPayload("100.84.12.9", 2351, "abc"),
        PairingCodec.parse("""{"afk":1,"host":"100.84.12.9","port":2351,"token":"abc","x":[1]}""")
            .getOrThrow()
    )

    @Test fun acceptsBothEndsOfThePortRange() {
        for (port in listOf(1, 65535)) {
            val raw = """{"afk":1,"host":"h","port":$port,"token":"t"}"""
            assertEquals(port, PairingCodec.parse(raw).getOrThrow().port)
        }
    }

    @Test fun rejectsWrongVersion() =
        assertTrue(PairingCodec.parse("""{"afk":2,"host":"h","token":"t"}""").isFailure)

    @Test fun rejectsMissingVersion() =
        assertTrue(PairingCodec.parse("""{"host":"h","token":"t"}""").isFailure)

    @Test fun rejectsBlankToken() =
        assertTrue(PairingCodec.parse("""{"afk":1,"host":"h","token":""}""").isFailure)

    @Test fun rejectsWhitespaceToken() =
        assertTrue(PairingCodec.parse("""{"afk":1,"host":"h","token":"  "}""").isFailure)

    @Test fun rejectsBlankHost() =
        assertTrue(PairingCodec.parse("""{"afk":1,"host":" ","token":"t"}""").isFailure)

    @Test fun rejectsPortOutOfRange() {
        for (port in listOf(0, -1, 65536)) {
            val raw = """{"afk":1,"host":"h","port":$port,"token":"t"}"""
            assertTrue("port $port", PairingCodec.parse(raw).isFailure)
        }
    }

    @Test fun rejectsWhatIsNotAPairingPayload() {
        val inputs = listOf(
            "",
            "hello",
            "https://example.com",
            "[]",
            "null",
            """{"afk":1,"host":"h"}""",
            """{"afk":1,"token":"t"}""",
            """{"afk":1,"host":"h","port":"abc","token":"t"}""",
            """{"afk":1,"host":"h","port":99999999999,"token":"t"}"""
        )
        for (raw in inputs) assertTrue("input <$raw>", PairingCodec.parse(raw).isFailure)
    }

    @Test fun endpointCarriesHostAndPort() = assertEquals(
        Endpoint("100.84.12.9", 2351),
        PairingPayload("100.84.12.9", 2351, "t").endpoint()
    )
}
