"""Transit tests. Provider responses are hand-written fixtures shaped like the documented
formats (ODsay releaseReference, TAGO listings) — they are test data, not real results."""
import httpx
import respx

from conftest import DLAT, DLON, LAT0, LON0, make_trip, node, set_keys

ODSAY_OK = {"result": {"searchType": 0, "path": [
    {"pathType": 2, "info": {"totalTime": 25, "payment": 1550, "busTransitCount": 1, "subwayTransitCount": 0,
                             "totalWalk": 420, "mapObj": "1234:1:5:9"},
     "subPath": [
         {"trafficType": 3, "distance": 200, "sectionTime": 3},
         {"trafficType": 2, "distance": 3000, "sectionTime": 18, "stationCount": 6,
          "lane": [{"busNo": "1003", "busID": 99}], "startName": "A정류장", "startX": LON0 + 2 * DLON, "startY": LAT0 + DLAT,
          "endName": "B정류장", "endX": LON0 + 5 * DLON, "endY": LAT0 + 5 * DLAT},
         {"trafficType": 3, "distance": 220, "sectionTime": 4}]},
    {"pathType": 3, "info": {"totalTime": 22, "payment": 1700, "busTransitCount": 1, "subwayTransitCount": 1,
                             "totalWalk": 900, "mapObj": "x"},
     "subPath": [
         {"trafficType": 1, "distance": 4000, "sectionTime": 12, "stationCount": 4,
          "lane": [{"name": "부산 1호선", "subwayCode": 71}], "startName": "부산역", "startX": 129.04, "startY": 35.11,
          "endName": "서면", "endX": 129.05, "endY": 35.15},
         {"trafficType": 2, "sectionTime": 10, "lane": [{"busNo": "10"}], "startName": "서면", "startX": 129.05,
          "startY": 35.15, "endName": "C", "endX": 129.06, "endY": 35.16}]},
]}}


def _o():
    a, b = node(0, 0), node(5, 5)
    return {"origin": {"lat": a[0], "lon": a[1], "label": "숙소"}, "destination": {"lat": b[0], "lon": b[1], "label": "광안리"}}


def test_no_key_means_not_configured_with_external_links(client):
    make_trip(client)
    r = client.post("/api/transit/routes", json=_o()).json()
    assert r["status"] == "NOT_CONFIGURED" and r["options"] == []
    assert any("map.kakao.com/link/from/" in l["url"] for l in r["external_links"])
    assert r["freshness"]["status"] == "UNAVAILABLE"


@respx.mock
def test_odsay_routes_normalized_sorted_with_walk_geometry(client, monkeypatch):
    set_keys(monkeypatch, odsay="k")
    make_trip(client)
    respx.get("https://api.odsay.com/v1/api/searchPubTransPathT").mock(return_value=httpx.Response(200, json=ODSAY_OK))
    r = client.post("/api/transit/routes", json={**_o(), "departure_at": "2026-12-21T09:00:00+09:00"}).json()
    assert r["status"] == "OK" and r["provider"] == "ODSAY" and r["attribution"] == "powered by www.ODsay.com"
    assert r["time_basis"] == "CURRENT" and "지원하지 않아요" in r["time_basis_note"]
    assert [o["total_minutes"] for o in r["options"]] == [22, 25]
    bus = next(o for o in r["options"] if o["total_minutes"] == 25)
    assert bus["transfer_count"] == 0 and bus["fare_krw"] == 1550 and bus["lines"] == ["1003"]
    walk0 = bus["legs"][0]
    assert walk0["mode"] == "WALK" and walk0["geometry_source"] == "OSMNX"  # computed by us, not invented
    assert bus["legs"][1]["line_color"] is None  # ODsay gives no colour -> none shown
    subway = r["options"][0]
    assert subway["transfer_count"] == 1
    r2 = client.post("/api/transit/routes", json={**_o(), "sort": "walk"}).json()
    assert r2["options"][0]["walk_distance_m"] == 420
    r3 = client.post("/api/transit/routes", json={**_o(), "sort": "transfers"}).json()
    assert r3["options"][0]["transfer_count"] == 0


@respx.mock
def test_odsay_errors_are_distinguished(client, monkeypatch):
    set_keys(monkeypatch, odsay="k")
    make_trip(client)
    route = respx.get("https://api.odsay.com/v1/api/searchPubTransPathT")
    route.mock(return_value=httpx.Response(200, json={"error": [{"code": "500", "message": "[ApiKeyAuthFailed] ApiKey authentication failed."}]}))
    assert client.post("/api/transit/routes", json=_o()).json()["status"] == "UNAVAILABLE"
    route.mock(return_value=httpx.Response(200, json={"error": {"code": "-98", "msg": "too close"}}))
    assert client.post("/api/transit/routes", json=_o()).json()["status"] == "TOO_CLOSE"
    route.mock(return_value=httpx.Response(200, json={"error": {"code": "-99", "msg": "none"}}))
    assert client.post("/api/transit/routes", json=_o()).json()["status"] == "NO_ROUTE"
    route.mock(return_value=httpx.Response(429, json={}))
    r = client.post("/api/transit/routes", json=_o()).json()
    assert r["status"] == "QUOTA_EXCEEDED" and r["external_links"]
    # cool-down: next call does not hit the provider
    calls = route.call_count
    assert client.post("/api/transit/routes", json=_o()).json()["status"] == "QUOTA_EXCEEDED"
    assert route.call_count == calls


@respx.mock
def test_odsay_server_error_retries_with_backoff(client, monkeypatch):
    set_keys(monkeypatch, odsay="k")
    make_trip(client)
    route = respx.get("https://api.odsay.com/v1/api/searchPubTransPathT").mock(side_effect=[
        httpx.Response(200, json={"error": [{"code": "500", "message": "server"}]}),
        httpx.Response(200, json=ODSAY_OK)])
    assert client.post("/api/transit/routes", json=_o()).json()["status"] == "OK"
    assert route.call_count == 2


def test_nearby_stops_osm_only_with_real_walk_distance(client):
    make_trip(client)
    lat, lon = node(0, 0)
    r = client.get("/api/transit/stops/nearby", params={"lat": lat, "lon": lon, "radius": 800}).json()
    assert r["providers"]["TAGO_BUS_STOP"] == "NOT_CONFIGURED"
    kinds = {s["kind"] for s in r["stops"]}
    assert kinds == {"BUS", "SUBWAY", "RAIL"}
    bus = next(s for s in r["stops"] if s["kind"] == "BUS")
    assert bus["walk_status"] == "OK" and bus["walk_distance_m"] >= bus["straight_distance_m"]
    assert bus["sources"][0]["realtime_supported"] is False
    small = client.get("/api/transit/stops/nearby", params={"lat": lat, "lon": lon, "radius": 300}).json()
    assert len(small["stops"]) < len(r["stops"])


@respx.mock
def test_nearby_stops_merges_tago_and_osm_without_id_conversion(client, monkeypatch):
    set_keys(monkeypatch, tago="k")
    make_trip(client)
    blat, blon = LAT0 + 1 * DLAT, LON0 + 2 * DLON
    respx.get("https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList").mock(
        return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "00", "resultMsg": "OK"}, "body": {
            "items": {"item": {"citycode": 21, "gpslati": blat + 0.00005, "gpslong": blon, "nodeid": "BSB1",
                               "nodenm": "테스트정류장", "nodeno": "05123"}}, "totalCount": 1}}}))
    respx.get("https://apis.data.go.kr/1613000/ArvlInfoInqireService/getCtyCodeList").mock(
        return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "00"}, "body": {
            "items": {"item": [{"citycode": 25, "cityname": "대전광역시"}]}, "totalCount": 1}}}))
    lat, lon = node(0, 0)
    r = client.get("/api/transit/stops/nearby", params={"lat": lat, "lon": lon, "radius": 500}).json()
    merged = [s for s in r["stops"] if s["kind"] == "BUS"]
    assert len(merged) == 1
    srcs = {x["provider"]: x for x in merged[0]["sources"]}
    assert srcs["TAGO"]["stop_id"] == "BSB1" and srcs["OSM"]["stop_id"] == "node/1"
    # city 21 is not in the (fixture) arrival city list -> realtime not supported
    assert srcs["TAGO"]["realtime_supported"] is False
    assert merged[0]["key"] == "TAGO:21:BSB1"


def test_arrivals_for_osm_stop_and_without_key(client):
    make_trip(client)
    r = client.get("/api/transit/stops/OSM:node/1/arrivals").json()
    assert r["status"] == "UNSUPPORTED_STOP" and r["message"] == "실시간 도착정보를 제공하지 않는 정류장입니다."
    r = client.get("/api/transit/stops/TAGO:21:BSB1/arrivals").json()
    assert r["status"] == "NOT_CONFIGURED"


@respx.mock
def test_arrivals_live_empty_region_and_errors(client, monkeypatch):
    set_keys(monkeypatch, tago="k")
    make_trip(client)
    respx.get("https://apis.data.go.kr/1613000/ArvlInfoInqireService/getCtyCodeList").mock(
        return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "00"}, "body": {
            "items": {"item": [{"citycode": 21, "cityname": "부산광역시"}]}, "totalCount": 1}}}))
    arr = respx.get("https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList")
    arr.mock(return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "00"}, "body": {"items": {"item": [
        {"routeid": "R2", "routeno": 1003, "arrtime": 600, "arrprevstationcnt": 5, "vehicletp": "일반차량"},
        {"routeid": "R1", "routeno": 41, "arrtime": 120, "arrprevstationcnt": 1, "vehicletp": "저상버스"}]}, "totalCount": 2}}}))
    r = client.get("/api/transit/stops/TAGO:21:BSB1/arrivals").json()
    assert r["status"] == "OK" and [a["route_no"] for a in r["arrivals"]] == ["41", "1003"]
    assert r["freshness"]["status"] == "LIVE" and r["freshness"]["fetched_at"]
    assert client.get("/api/transit/stops/TAGO:37010:PHB1/arrivals").json()["status"] == "UNSUPPORTED_REGION"
    arr.mock(return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "03", "resultMsg": "NODATA_ERROR"}}}))
    from app.providers import tago_bus
    tago_bus.arrivals_runtime._cache.clear()
    assert client.get("/api/transit/stops/TAGO:21:BSB2/arrivals").json()["status"] == "EMPTY"
    arr.mock(return_value=httpx.Response(403, json={"OpenAPI_ServiceResponse": {"cmmMsgHeader": {
        "errMsg": "SERVICE_KEY_IS_NOT_REGISTERED_ERROR", "returnReasonCode": "30"}}}))
    assert client.get("/api/transit/stops/TAGO:21:BSB3/arrivals").json()["status"] == "AUTH_FAILED"
    arr.mock(return_value=httpx.Response(200, json={"response": {"header": {"resultCode": "22", "resultMsg": "LIMITED"}}}))
    assert client.get("/api/transit/stops/TAGO:21:BSB4/arrivals").json()["status"] == "QUOTA_EXCEEDED"


def test_provider_status_never_claims_verified_without_success(client, monkeypatch):
    set_keys(monkeypatch, odsay="k")
    st = {p["provider"]: p for p in client.get("/api/providers/status").json()["providers"]}
    assert st["ODSAY"]["state"] == "CONFIGURED_UNVERIFIED"
    assert st["TAGO_TRAIN"]["state"] == "NOT_CONFIGURED"
