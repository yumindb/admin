import { describe, it, expect } from "vitest";
import {
  haversineMeters,
  parseGoogleMapsUrl,
  formatDistance,
  evaluateGeofence,
  googleMapsLink,
} from "../geo";

describe("haversineMeters", () => {
  it("returns 0 for same point", () => {
    expect(haversineMeters({ lat: 25, lng: 121 }, { lat: 25, lng: 121 })).toBe(0);
  });

  it("台北 101 → 中正紀念堂 約 3.6 km", () => {
    const taipei101 = { lat: 25.0337, lng: 121.5645 };
    const cks = { lat: 25.0347, lng: 121.5217 };
    const d = haversineMeters(taipei101, cks);
    expect(d).toBeGreaterThan(4200);
    expect(d).toBeLessThan(4400);
  });

  it("100 m 級距精度", () => {
    const a = { lat: 25.0, lng: 121.0 };
    const b = { lat: 25.0009, lng: 121.0 }; // ~100 m 北
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(105);
  });
});

describe("parseGoogleMapsUrl", () => {
  it("@lat,lng,zoom 形式", () => {
    expect(parseGoogleMapsUrl("https://www.google.com/maps/@25.0330,121.5654,17z")).toEqual({
      lat: 25.033,
      lng: 121.5654,
    });
  });

  it("place URL with @ 座標", () => {
    expect(
      parseGoogleMapsUrl(
        "https://www.google.com/maps/place/Taipei+101/@25.0337,121.5645,17z/data=!3m1",
      ),
    ).toEqual({ lat: 25.0337, lng: 121.5645 });
  });

  it("?q=lat,lng", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/?q=25.0330,121.5654")).toEqual({
      lat: 25.033,
      lng: 121.5654,
    });
  });

  it("?q=loc:lat,lng", () => {
    expect(
      parseGoogleMapsUrl("https://www.google.com/maps?q=loc:25.0330,121.5654"),
    ).toEqual({ lat: 25.033, lng: 121.5654 });
  });

  it("?ll=lat,lng", () => {
    expect(parseGoogleMapsUrl("https://maps.google.com/maps?ll=25.0330,121.5654")).toEqual({
      lat: 25.033,
      lng: 121.5654,
    });
  });

  it("純座標字串", () => {
    expect(parseGoogleMapsUrl("25.0330, 121.5654")).toEqual({
      lat: 25.033,
      lng: 121.5654,
    });
    expect(parseGoogleMapsUrl("25.0330,121.5654")).toEqual({
      lat: 25.033,
      lng: 121.5654,
    });
  });

  it("空字串 / 找不到回 null", () => {
    expect(parseGoogleMapsUrl("")).toBeNull();
    expect(parseGoogleMapsUrl("https://google.com")).toBeNull();
    expect(parseGoogleMapsUrl("不是 URL")).toBeNull();
  });

  it("0,0 不接受(海上,幾乎一定是錯)", () => {
    expect(parseGoogleMapsUrl("0,0")).toBeNull();
    expect(parseGoogleMapsUrl("https://www.google.com/maps/@0,0,17z")).toBeNull();
  });

  it("超出地球範圍不接受", () => {
    expect(parseGoogleMapsUrl("100,200")).toBeNull();
    expect(parseGoogleMapsUrl("-91,0")).toBeNull();
  });

  it("負數(南半球 / 西半球)", () => {
    expect(parseGoogleMapsUrl("-33.8688,151.2093")).toEqual({
      lat: -33.8688,
      lng: 151.2093,
    });
  });
});

describe("formatDistance", () => {
  it("< 1000 m 顯示整數公尺", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(123.7)).toBe("124 m");
    expect(formatDistance(999)).toBe("999 m");
  });

  it(">= 1000 m 顯示 1 位小數公里", () => {
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(formatDistance(12345)).toBe("12.3 km");
  });

  it("NaN / Infinity 回 dash", () => {
    expect(formatDistance(NaN)).toBe("—");
    expect(formatDistance(Infinity)).toBe("—");
  });
});

describe("evaluateGeofence", () => {
  const caseLoc = { lat: 25.0337, lng: 121.5645, geofence_radius_m: 200 };

  it("案件無座標 → distance null + withinGeofence null", () => {
    const r = evaluateGeofence(
      { lat: null, lng: null, geofence_radius_m: 200 },
      { lat: 25.0337, lng: 121.5645 },
    );
    expect(r.distanceM).toBeNull();
    expect(r.withinGeofence).toBeNull();
  });

  it("打卡點與案件相同 → 0 m + within true", () => {
    const r = evaluateGeofence(caseLoc, { lat: 25.0337, lng: 121.5645 });
    expect(r.distanceM).toBe(0);
    expect(r.withinGeofence).toBe(true);
  });

  it("打卡點距離 > 半徑 → within false", () => {
    // ~4.4 km 外
    const r = evaluateGeofence(caseLoc, { lat: 25.0347, lng: 121.5217 });
    expect(r.distanceM).toBeGreaterThan(200);
    expect(r.withinGeofence).toBe(false);
  });
});

describe("googleMapsLink", () => {
  it("回傳 google.com/maps?q= 形式 + 6 位小數", () => {
    expect(googleMapsLink({ lat: 25.033, lng: 121.5654 })).toBe(
      "https://www.google.com/maps?q=25.033000,121.565400",
    );
  });
});
