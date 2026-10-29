
package com.yottaflex.attribution;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcOperations;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CampaignControllerTest {

    private JdbcOperations jdbc;
    private CampaignController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcOperations.class);
        controller = new CampaignController(jdbc);
    }

    @Test
    void rejectsUnsupportedAttributionModel() {
        ResponseStatusException exception = assertThrows(
            ResponseStatusException.class,
            () -> controller.getCampaigns("UNKNOWN")
        );

        assertEquals(400, exception.getStatusCode().value());
        verifyNoInteractions(jdbc);
    }

    @Test
    void normalizesModelToUppercase() {
        when(jdbc.queryForList(contains("FROM campaign c"))).thenReturn(List.of());

        Map<String, Object> response = controller.getCampaigns("linear");

        assertEquals("ok", response.get("status"));
        assertEquals("LINEAR", response.get("model"));
        assertEquals(0, response.get("count"));
        assertTrue(response.get("dataNote").toString()
            .contains("v2-eligible-90d"));
    }

    @Test
    void returnsExpectedCampaignResponseStructure() {
        when(jdbc.queryForList(contains("FROM campaign c"))).thenReturn(List.of());

        Map<String, Object> response = controller.getCampaigns("FIRST_TOUCH");

        assertTrue(response.containsKey("status"));
        assertTrue(response.containsKey("model"));
        assertTrue(response.containsKey("count"));
        assertTrue(response.containsKey("dataNote"));
        assertTrue(response.containsKey("campaigns"));
        assertEquals("FIRST_TOUCH", response.get("model"));
    }
}
