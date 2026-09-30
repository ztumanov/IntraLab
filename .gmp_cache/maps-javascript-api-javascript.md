---
name: maps-javascript-api-javascript
description: Developers use the Maps JavaScript API skill to embed customizable, interactive 2D and photorealistic 3D maps into web applications. This enables advanced location intelligence features, including real-time route calculation, dynamic geospatial data visualization (GeoJSON, KML), Address Validation, and comprehensive search capabilities powered by the Places API and Street View service.
license: Apache-2.0
metadata:
  version: 1.0.56
---

> [!IMPORTANT] **Core Dependency:** This skill requires active context from
> [google-maps-platform/SKILL.md](https://www.gstatic.com/googlemapsplatform-agent-skills/google-maps-platform/SKILL.md).

### Overview

The Maps JavaScript API is the primary library for integrating Google Maps
Platform functionality into web applications. It provides comprehensive tools
for map rendering, user interaction, location intelligence, and data
visualization.

### Mandatory settings

The Maps JavaScript API requires the inclusion of a solution ID
(`internalUsageAttributionIds`) in map configuration objects, component
constructors, and API request objects for mandatory usage tracking and
attribution.

#### JavaScript Configuration Object

Used when initializing core Maps objects (`google.maps.Map`,
`AdvancedMarkerElement`, `StreetViewPanorama`), Place UI Kit element
constructors, or various service requests (Places, Routes, Geocoding, Address
Validation, Fleet Tracking).

```javascript
const mapOptions = {
    center: { lat: 34.0, lng: -118.0 },
    zoom: 10,
    // Mandatory setting
    internalUsageAttributionIds: ['gmp_git_agentskills_v1']
};

// Example for Place Autocomplete element constructor:
const placeAutocomplete = new PlaceAutocompleteElement({
    internalUsageAttributionIds: ['gmp_git_agentskills_v1']
});
```

#### HTML Web Component Attribute

Used when initializing Google Maps Web Components (`<gmp-map>`, `<gmp-map-3d>`)
and declarative Place UI Kit elements.

```html
<gmp-map
    center="40.749933,-73.98633"
    zoom="13"
    map-id="DEMO_MAP_ID"
    internal-usage-attribution-ids="gmp_git_agentskills_v1">
</gmp-map>

<!-- Example for a Place UI Kit element -->
<gmp-place-details
    internal-usage-attribution-ids="gmp_git_agentskills_v1"
    place-id="ChIJu4pXG4wPz4AR3y-6c0-x8sY">
</gmp-place-details>
```

### Key Functional Areas

*   **Map Rendering & Customization:** Embed interactive 2D maps, Photorealistic
    3D maps, and Street View experiences. Apply extensive styling controls using
    Map IDs, affecting roads, landmarks, and map features. Supports Advanced
    Markers and various overlays (polylines, polygons, deck.gl).
*   **Location & Geometry Services:** Access Geocoding, Reverse Geocoding, and
    Elevation services for coordinate and address translation. Includes robust
    Address Validation features supporting USPS CASS certification.
*   **Routing and Travel:** Utilize the Routes API functionality (via the
    `Route` and `RouteMatrix` classes) for calculating turn-by-turn directions,
    distances, and travel times between origins and destinations, supporting
    various travel modes and traffic considerations.
*   **Places and Search:** Integrate detailed Place information, including
    search (Text Search, Nearby Search), details retrieval, photos, reviews, and
    interactive UI components like the Autocomplete Widget.
*   **Data Visualization:** Overlay complex geospatial data using standard
    formats like GeoJSON, KML, and GeoRSS, or utilize custom datasets for
    advanced choropleth and feature-based styling.
*   **Fleet Management Integration:** Provides specialized libraries for
    visualizing real-time vehicle and task locations, routes, and events from
    Fleet Engine on a map.

## 🚀 Master Orchestration Integration Workflow

Follow this multi-phase sequential integration checklist to compose features
robustly. For each phase, read the referenced capability sub-workflow file and
satisfy its *Evidence Checkpoint* before advancing.

### 📦 Phase 1: Core Initialization & Base Setup (Primary)

-   [ ] **Step 1.1: Initializes and displays the core interactive 2D map
    component in a designated container element.** Read
    [add-customizable-interactive-map-web-page-mobile-app.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-customizable-interactive-map-web-page-mobile-app.md).
    *Trigger Condition*: User needs to render a basic, interactive Google Map
    instance on the page. *Evidence Checkpoint*: A Map object instance is
    successfully created and rendered in the specified DOM element.
-   [ ] **Step 1.2: Initializes and embeds an interactive Street View panorama
    viewer component.** Read
    [add-configurable-interactive-google-street-view-web-page-mobile-app.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-configurable-interactive-google-street-view-web-page-mobile-app.md).
    *Trigger Condition*: User needs to display a 360-degree panorama experience
    for a specific location. *Evidence Checkpoint*: A Street View Panorama
    object instance is successfully created and rendered in the DOM.

### 📦 Phase 2: Feature Layer & Custom Enrichment (Supplemental)

#### 🗺️ Feature Module: Address validation (Optional - Use-Case Dependent)

-   [ ] **Returns a validated and normalized address structure based on a
    specified address or partial address input.** Read
    [return-validated-address-for-specified-address-partial-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-validated-address-for-specified-address-partial-address.md).
    *Trigger Condition*: When the user provides an address string (full or
    partial) and needs the validated postal address components. *Evidence
    Checkpoint*: The service returns a standardized address object with
    validation results.
-   [ ] **Retrieves the precise latitude and longitude coordinates associated
    with a validated address.** Read
    [return-the-latitude-longitude-coordinates-for-validated-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-latitude-longitude-coordinates-for-validated-address.md).
    *Trigger Condition*: When the user needs the geographic location (lat/lng)
    of a validated address. *Evidence Checkpoint*: The service returns a
    validated address object containing geographic coordinates.
-   [ ] **Returns the unique Google Place ID corresponding to a validated
    address.** Read
    [return-the-google-place-identifier-for-validated-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-google-place-identifier-for-validated-address.md).
    *Trigger Condition*: When the user needs the Google Place Identifier to link
    the address to other Google Places data. *Evidence Checkpoint*: The
    validated address object includes a non-null 'place_id' field.
-   [ ] **Enables the use of USPS CASS certification processes for improved
    address validation accuracy within the United States.** Read
    [use-united-states-postal-service-usps-coding-accuracy-support-system.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/use-united-states-postal-service-usps-coding-accuracy-support-system.md).
    *Trigger Condition*: When requiring USPS CASS certification details for US
    address validation requests. *Evidence Checkpoint*: The address validation
    response includes CASS metadata indicators.
-   [ ] **Identifies and returns metadata indicating whether a validated address
    corresponds to a business, residence, or PO Box.** Read
    [return-information-about-whether-validated-address-business-residence-box.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-information-about-whether-validated-address-business-residence-box.md).
    *Trigger Condition*: When the user needs to classify the type of premises
    associated with the validated address. *Evidence Checkpoint*: The validation
    result contains address type classification information.
-   [ ] **Provides USPS-specific delivery metadata (such as delivery point
    validation) for validated U.S. addresses.** Read
    [return-united-states-postal-service-usps-delivery-metadata-for-validated.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-united-states-postal-service-usps-delivery-metadata-for-validated.md).
    *Trigger Condition*: When needing granular USPS delivery confirmation
    metadata for a U.S. address. *Evidence Checkpoint*: The validation response
    contains USPS delivery data points.
-   [ ] **Returns the validated address formatted in the English language,
    regardless of the input language.** Read
    [return-english-language-version-validated-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-english-language-version-validated-address.md).
    *Trigger Condition*: When requiring the standardized address output to be in
    English. *Evidence Checkpoint*: The address string in the response is
    formatted using English language conventions.
-   [ ] **Returns the Plus Code (Open Location Code) associated with the
    validated address location.** Read
    [return-the-plus-code-for-validated-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-plus-code-for-validated-address.md).
    *Trigger Condition*: When requiring a Plus Code representation for the
    address location. *Evidence Checkpoint*: The validation response includes a
    valid Plus Code string.

#### 🗺️ Feature Module: Maps styling (Optional - Use-Case Dependent)

-   [ ] **Defines and registers a map style configuration that can be reused
    across different platforms via a Map ID.** Read
    [create-reusable-cross-platform-map-style.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/create-reusable-cross-platform-map-style.md).
    *Trigger Condition*: When defining custom visual aesthetics for maps to
    ensure consistency across applications. *Evidence Checkpoint*: A Map Style
    is successfully defined and associated with a Map ID.
-   [ ] **Applies custom styling properties (color, weight, visibility) to road
    features, polylines, and polygons on the map.** Read
    [change-the-style-roads-polylines-and-polygons-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-roads-polylines-and-polygons-map.md).
    *Trigger Condition*: When needing to visually customize vector features like
    roads or boundaries. *Evidence Checkpoint*: Map vector geometry renders with
    the specified custom styling.
-   [ ] **Controls the visibility of specific map features, such as points of
    interest, transit stations, or waterways.** Read
    [display-hide-map-features.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/display-hide-map-features.md).
    *Trigger Condition*: When needing to suppress or display certain categories
    of map data. *Evidence Checkpoint*: The specified map features are correctly
    hidden or shown on the map display.
-   [ ] **Customizes the appearance of icons and associated text labels for
    points of interest and map elements.** Read
    [change-the-style-icons-and-text-labels-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-icons-and-text-labels-map.md).
    *Trigger Condition*: When needing to adjust the presentation of POI markers
    and names. *Evidence Checkpoint*: Map icons and labels adopt the custom
    colors and sizes defined in the style.
-   [ ] **Applies distinct styling rules based on the map's current zoom level
    (e.g., showing more detail when zoomed in).** Read
    [apply-different-map-styles-different-zoom-levels.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/apply-different-map-styles-different-zoom-levels.md).
    *Trigger Condition*: When requiring dynamic styling changes triggered by map
    zoom interactions. *Evidence Checkpoint*: Style definitions switch correctly
    as the map zoom level changes.
-   [ ] **Adjusts the density of visible points of interest (POI) shown on the
    map.** Read
    [change-the-density-places-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-density-places-map.md).
    *Trigger Condition*: When needing to declutter the map or emphasize POIs.
    *Evidence Checkpoint*: The number of POI labels visible changes according to
    the defined density setting.
-   [ ] **Customizes the visualization of building footprints and 3D building
    elements.** Read
    [change-the-style-buildings-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-buildings-map.md).
    *Trigger Condition*: When needing to change the appearance or visibility of
    building geometry. *Evidence Checkpoint*: Building features render with
    modified colors or outlines.
-   [ ] **Applies custom styling to map landmarks.** Read
    [change-the-style-landmarks-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-landmarks-map.md).
    *Trigger Condition*: When specific landmarks require visual distinction on
    the map. *Evidence Checkpoint*: Landmark features display the configured
    custom styles.

#### 🗺️ Feature Module: Data-driven styling for boundaries (Optional - Use-Case Dependent)

-   [ ] **Allows customization of boundaries (e.g., country, state, postal code
    areas) based on defined feature types and IDs.** Read
    [change-the-style-boundaries-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-boundaries-map.md).
    *Trigger Condition*: When styling administrative or political boundaries
    dynamically. *Evidence Checkpoint*: Boundaries of the specified type are
    styled according to the configuration.
-   [ ] **Adds event handlers to respond to user interactions (e.g., click,
    hover) with styled map boundaries.** Read
    [respond-user-interactions-with-boundaries-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-user-interactions-with-boundaries-map.md).
    *Trigger Condition*: When interactivity with geopolitical or administrative
    boundaries is required. *Evidence Checkpoint*: A defined callback function
    executes upon interaction with a styled boundary.
-   [ ] **Applies choropleth styling (color mapping based on data values) to map
    boundaries.** Read
    [add-choropleth-styling-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-choropleth-styling-map.md).
    *Trigger Condition*: When visualizing geographical data distribution using
    color intensity across boundaries. *Evidence Checkpoint*: Boundaries are
    shaded or colored based on associated quantitative data values.

#### 🗺️ Feature Module: Datasets (Optional - Use-Case Dependent)

-   [ ] **Displays geographic data supplied in a KML (Keyhole Markup Language)
    file as an overlay on the map.** Read
    [add-kml-layer-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-kml-layer-map.md).
    *Trigger Condition*: When needing to render geographical data stored in KML
    format. *Evidence Checkpoint*: KML features (points, lines, polygons) are
    rendered as a map layer.
-   [ ] **Displays dynamic geographical content supplied via a GeoRSS feed as a
    map overlay.** Read
    [add-georss-layer-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-georss-layer-map.md).
    *Trigger Condition*: When needing to visualize frequently updated
    geographical data provided via RSS. *Evidence Checkpoint*: GeoRSS items
    appear correctly positioned on the map.
-   [ ] **Adds features defined in the GeoJSON format directly onto the map as a
    data layer.** Read
    [add-geojson-data-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-geojson-data-map.md).
    *Trigger Condition*: When integrating data formatted using the GeoJSON
    standard into the map visualization. *Evidence Checkpoint*: GeoJSON geometry
    and properties are loaded into the map's Data layer.

#### 🗺️ Feature Module: Data-driven styling for datasets (Optional - Use-Case Dependent)

-   [ ] **Creates a reusable, centralized dataset of geospatial features
    accessible across different applications and maps.** Read
    [create-reusable-cross-platform-geospatial-dataset.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/create-reusable-cross-platform-geospatial-dataset.md).
    *Trigger Condition*: When defining custom collections of map features
    (geospatial data) for shared use. *Evidence Checkpoint*: A dataset is
    successfully created with defined feature schemas.
-   [ ] **Loads and displays a user-defined custom geospatial dataset onto the
    map.** Read
    [add-custom-geospatial-dataset-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-custom-geospatial-dataset-map.md).
    *Trigger Condition*: When retrieving and visualizing a custom, externally
    defined dataset on the map. *Evidence Checkpoint*: The custom dataset
    features are successfully rendered on the map.
-   [ ] **Applies custom visual styling to the features within a geospatial
    dataset (e.g., coloring polygons based on feature properties).** Read
    [change-the-style-custom-dataset-features-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-custom-dataset-features-map.md).
    *Dependencies*: `["add-custom-geospatial-dataset-map.md"]` *Trigger
    Condition*: When needing to differentiate or highlight features within a
    custom dataset. *Evidence Checkpoint*: Dataset features render according to
    the custom styling rules.
-   [ ] **Sets up event listeners to respond to clicks or hovers on features
    belonging to a custom geospatial dataset.** Read
    [respond-user-interactions-with-custom-dataset-features-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-user-interactions-with-custom-dataset-features-map.md).
    *Dependencies*: `["add-custom-geospatial-dataset-map.md"]` *Trigger
    Condition*: When requiring interactive feedback or logic execution upon user
    engagement with dataset features. *Evidence Checkpoint*: The defined event
    handler fires when a dataset feature is clicked or hovered over.

#### 🗺️ Feature Module: Directions and Routing (Optional - Use-Case Dependent)

-   [ ] **Calculates a route and returns the precise latitude/longitude
    coordinates defining the path step-by-step.** Read
    [return-directions-between-two-more-latitude-longitude-coordinates-series-coordinates-for.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-directions-between-two-more-latitude-longitude-coordinates-series-coordinates-for.md).
    *Trigger Condition*: When needing the raw geographical path coordinates of a
    route. *Evidence Checkpoint*: The directions response contains a detailed
    array of coordinate pairs defining the route polyline.
-   [ ] **Calculates a route and returns text descriptions of the driving
    maneuvers required for each step.** Read
    [return-directions-between-two-more-sets-latitude-longitude-coordinates-series-maneuver.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-directions-between-two-more-sets-latitude-longitude-coordinates-series-maneuver.md).
    *Trigger Condition*: When generating turn-by-turn navigation instructions
    for a route. *Evidence Checkpoint*: The directions response includes text
    instructions detailing required maneuvers (e.g., 'Turn left onto...').
-   [ ] **Returns the geographical distance covered during each intermediate
    step of a calculated route.** Read
    [return-the-distance-between-each-step-along-route-between-two.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-distance-between-each-step-along-route-between-two.md).
    *Trigger Condition*: When needing granular distance measurements for each
    leg of a multi-step route. *Evidence Checkpoint*: The directions response
    includes distance values for every step/leg of the journey.
-   [ ] **Returns the estimated time taken to travel during each intermediate
    step of a calculated route.** Read
    [return-the-travel-time-between-each-step-along-route-between.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-travel-time-between-each-step-along-route-between.md).
    *Trigger Condition*: When needing granular travel time estimations for each
    segment of the route. *Evidence Checkpoint*: The directions response
    includes travel time values for every step/leg.
-   [ ] **Returns an encoded polyline string representing the path for each step
    along the route.** Read
    [return-encoded-polyline-between-each-step-along-route-between-two.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-encoded-polyline-between-each-step-along-route-between-two.md).
    *Trigger Condition*: When efficient transmission of route geometry for
    visual rendering is required for individual steps. *Evidence Checkpoint*:
    The directions response provides encoded polyline strings for sub-route
    segments.
-   [ ] **Returns the total distance of the optimal route between the defined
    origin and destination points.** Read
    [return-the-distance-for-route-between-two-more-sets-latitude-longitude.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-distance-for-route-between-two-more-sets-latitude-longitude.md).
    *Trigger Condition*: When calculating the overall mileage or distance of a
    route. *Evidence Checkpoint*: The directions response includes the aggregate
    route distance.
-   [ ] **Returns the total estimated travel time for the optimal route between
    the defined origin and destination points.** Read
    [return-the-travel-time-for-route-between-two-more-sets.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-travel-time-for-route-between-two-more-sets.md).
    *Trigger Condition*: When calculating the estimated total time required for
    a journey. *Evidence Checkpoint*: The directions response includes the
    aggregate estimated travel time.
-   [ ] **Returns a single encoded polyline string representing the entire route
    path.** Read
    [return-encoded-polyline-for-route-between-two-more-sets-latitude-longitude.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-encoded-polyline-for-route-between-two-more-sets-latitude-longitude.md).
    *Trigger Condition*: When requiring an efficient representation of the full
    route geometry for rendering. *Evidence Checkpoint*: The directions response
    provides a single encoded polyline string for the entire route.
-   [ ] **Allows setting the desired mode of transportation (driving, walking,
    transit, bicycling) for route calculation.** Read
    [specify-the-travel-mode-drive-transit-walk-two-wheeled-for-route.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-the-travel-mode-drive-transit-walk-two-wheeled-for-route.md).
    *Trigger Condition*: When calculating a route specific to a non-default
    travel method. *Evidence Checkpoint*: The route calculation honors the
    specified travel mode parameters.
-   [ ] **Adds intermediate stops or waypoints to the route request, allowing
    multi-destination routes.** Read
    [specify-stop-pass-through-point-for-route-request.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-stop-pass-through-point-for-route-request.md).
    *Trigger Condition*: When the route must pass through specific geographical
    points between the origin and destination. *Evidence Checkpoint*: The
    resulting route polyline incorporates all specified waypoints/stops.
-   [ ] **Defines parameters for how real-time or historical traffic data should
    influence route calculation and travel time estimates.** Read
    [specify-how-traffic-data-used-route-request.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-how-traffic-data-used-route-request.md).
    *Trigger Condition*: When optimizing routes based on current or predicted
    traffic conditions. *Evidence Checkpoint*: The route time estimates reflect
    the specified traffic model (e.g., 'best_guess' or 'optimistic').
-   [ ] **Excludes specific road features, such as highways, tolls, or ferries,
    from the calculated route.** Read
    [specify-features-avoid-such-highways-tolls-for-route-request.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-features-avoid-such-highways-tolls-for-route-request.md).
    *Trigger Condition*: When generating routes that must avoid certain types of
    roads or crossings. *Evidence Checkpoint*: The calculated route path
    successfully bypasses the defined restricted features.
-   [ ] **Requests alternative route options or prioritizes the shortest
    possible distance over the fastest travel time.** Read
    [specify-shorter-distance-alternative-routing-for-routes-request.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-shorter-distance-alternative-routing-for-routes-request.md).
    *Trigger Condition*: When multiple route possibilities are desired or
    distance optimization is critical. *Evidence Checkpoint*: The response
    includes one or more alternative routes alongside the primary route.
-   [ ] **Calculates and returns the distances for routes covering all
    combinations of multiple origins and destinations.** Read
    [return-distances-for-matrix-routes-between-multiple-origins-and-destinations.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-distances-for-matrix-routes-between-multiple-origins-and-destinations.md).
    *Trigger Condition*: When needing distance data for a many-to-many routing
    scenario (Distance Matrix). *Evidence Checkpoint*: The matrix response
    returns distance values for every (origin, destination) pair.
-   [ ] **Calculates and returns the travel times for routes covering all
    combinations of multiple origins and destinations.** Read
    [return-travel-times-for-matrix-routes-between-multiple-origins-and.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-travel-times-for-matrix-routes-between-multiple-origins-and.md).
    *Trigger Condition*: When needing travel time data for a many-to-many
    routing scenario (Distance Matrix). *Evidence Checkpoint*: The matrix
    response returns travel time estimates for every (origin, destination) pair.
-   [ ] **Specifies the mode of transport (e.g., driving, transit) to use when
    calculating the Distance Matrix.** Read
    [specify-the-travel-mode-drive-transit-walk-two-wheeled-for-route.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-the-travel-mode-drive-transit-walk-two-wheeled-for-route.md).
    *Trigger Condition*: When calculating a Distance Matrix for a specific
    non-default travel mode. *Evidence Checkpoint*: The Distance Matrix
    calculations adhere to the specified travel mode.

#### 🗺️ Feature Module: Elevation (Optional - Use-Case Dependent)

-   [ ] **Retrieves the elevation (height above sea level) for a specific set of
    latitude/longitude coordinates.** Read
    [return-the-elevation-set-latitude-longitude-coordinates.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-elevation-set-latitude-longitude-coordinates.md).
    *Trigger Condition*: When needing the absolute elevation data for a single
    point or array of points. *Evidence Checkpoint*: The response returns the
    elevation value in meters for the queried point(s).
-   [ ] **Calculates and returns elevation data sampled along a defined path or
    segment.** Read
    [return-the-difference-elevation-along-path-between-two-more-sets.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-difference-elevation-along-path-between-two-more-sets.md).
    *Trigger Condition*: When analyzing the topographical profile or grade
    changes along a linear path. *Evidence Checkpoint*: The response returns
    elevation samples distributed along the specified path.

#### 🗺️ Feature Module: Fleet Engine (Optional - Use-Case Dependent)

-   [ ] **Adds markers and updates the real-time locations of Fleet Engine
    managed vehicles and associated tasks onto the map.** Read
    [add-the-real-time-location-fleet-engine-delivery-vehicles-and-tasks.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-the-real-time-location-fleet-engine-delivery-vehicles-and-tasks.md).
    *Trigger Condition*: When visualizing the current positions of delivery
    vehicles managed by Fleet Engine. *Evidence Checkpoint*: Vehicle markers
    appear on the map and update location dynamically.
-   [ ] **Renders the predicted future route segments for Fleet Engine delivery
    vehicles based on their current status and tasks.** Read
    [add-the-predicted-routes-fleet-engine-delivery-vehicles-and-tasks.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-the-predicted-routes-fleet-engine-delivery-vehicles-and-tasks.md).
    *Trigger Condition*: When providing predictive routing information for
    logistics tracking. *Evidence Checkpoint*: Route polylines representing
    predicted paths are drawn for active vehicles.
-   [ ] **Adds comprehensive visualization including vehicle location, stops,
    assigned tasks, and intermediate waypoints for Fleet Engine entities.** Read
    [add-fleet-engine-delivery-vehicle-s-location-stops-tasks-and-waypoint.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-fleet-engine-delivery-vehicle-s-location-stops-tasks-and-waypoint.md).
    *Trigger Condition*: When displaying a detailed view of a vehicle's entire
    operational plan and status. *Evidence Checkpoint*: The map shows markers
    for the vehicle, pickup points, and drop-off points.
-   [ ] **Configures listeners to react to status changes in Fleet Engine
    vehicles, such as trip completion or segment updates.** Read
    [respond-fleet-engine-delivery-vehicle-events-including-completed-trips-segments.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-fleet-engine-delivery-vehicle-events-including-completed-trips-segments.md).
    *Trigger Condition*: When integrating real-time logistics events into
    application workflows. *Evidence Checkpoint*: The application receives and
    processes lifecycle events (e.g., 'trip completed') from the Fleet Engine
    provider.
-   [ ] **Applies custom visual styling specifically to the road network
    visualization within a Fleet Engine map instance.** Read
    [change-the-style-roads-polylines-and-polygons-fleet-engine-fleet.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-roads-polylines-and-polygons-fleet-engine-fleet.md).
    *Trigger Condition*: When customizing the background map aesthetic
    underlying the fleet tracking data. *Evidence Checkpoint*: Road features on
    the fleet map display the custom styling defined.
-   [ ] **Controls the visibility of standard map features (e.g., POIs, parks)
    within the context of a Fleet Engine map.** Read
    [display-hide-map-features-fleet-engine-fleet-tracking-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/display-hide-map-features-fleet-engine-fleet-tracking-map.md).
    *Trigger Condition*: When adjusting the density or information load of the
    Fleet Engine map background. *Evidence Checkpoint*: The specified map
    features are correctly hidden or shown on the Fleet Engine map.
-   [ ] **Customizes the visual style of icons and text labels provided by the
    base map in a Fleet Engine implementation.** Read
    [change-the-style-icons-and-text-labels-fleet-engine-fleet.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-icons-and-text-labels-fleet-engine-fleet.md).
    *Trigger Condition*: When adjusting the appearance of base map labels (not
    fleet markers) for better context. *Evidence Checkpoint*: Base map icons and
    labels adopt the custom styles.
-   [ ] **Implements dynamic style switching based on the zoom level of the
    Fleet Engine map.** Read
    [apply-different-map-styles-different-zoom-levels-fleet-engine-fleet.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/apply-different-map-styles-different-zoom-levels-fleet-engine-fleet.md).
    *Trigger Condition*: When requiring adaptive styling based on map scale in
    fleet tracking applications. *Evidence Checkpoint*: Styles transition
    according to the configured zoom level breakpoints.
-   [ ] **Modifies the density of background places/POIs displayed on the Fleet
    Engine map view.** Read
    [change-the-density-places-fleet-engine-fleet-tracking-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-density-places-fleet-engine-fleet-tracking-map.md).
    *Trigger Condition*: When prioritizing fleet tracking data over surrounding
    POI visibility. *Evidence Checkpoint*: The place density setting is
    reflected in the background map rendering.
-   [ ] **Applies custom styling to building geometry and structures within the
    Fleet Engine map view.** Read
    [change-the-style-buildings-fleet-engine-fleet-tracking-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-buildings-fleet-engine-fleet-tracking-map.md).
    *Trigger Condition*: When modifying the visualization of buildings in the
    fleet tracking context. *Evidence Checkpoint*: Building features render with
    custom colors or visibility settings.
-   [ ] **Applies custom styling to landmarks shown on the base map used for
    Fleet Engine tracking.** Read
    [change-the-style-landmarks-fleet-engine-fleet-tracking-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-style-landmarks-fleet-engine-fleet-tracking-map.md).
    *Trigger Condition*: When needing to highlight or de-emphasize landmarks in
    the fleet view. *Evidence Checkpoint*: Landmark features display the
    specified custom styling.
-   [ ] **Customizes the appearance, icon, and behavior of vehicle and task
    markers provided by Fleet Engine.** Read
    [customize-marker-fleet-engine-fleet-tracking-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-marker-fleet-engine-fleet-tracking-map.md).
    *Trigger Condition*: When needing custom visual representation for tracked
    vehicles or drop-off points. *Evidence Checkpoint*: Vehicle markers utilize
    the custom icon and styling specified.
-   [ ] **Customizes the color, weight, and visual style of the route polyline
    drawn for Fleet Engine vehicles.** Read
    [customize-the-route-polyline-fleet-engine-fleet-tracking-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-the-route-polyline-fleet-engine-fleet-tracking-map.md).
    *Trigger Condition*: When adjusting the appearance of predicted or active
    route paths for better visibility. *Evidence Checkpoint*: Route polylines
    render with the customized stroke properties.

#### 🗺️ Feature Module: Geocoding (Optional - Use-Case Dependent)

-   [ ] **Converts a readable address or place name into its corresponding
    latitude and longitude coordinates (Geocoding).** Read
    [return-the-latitude-longitude-coordinates-address-geocoding.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-latitude-longitude-coordinates-address-geocoding.md).
    *Trigger Condition*: When needing to translate a textual address into
    geographical coordinates for mapping. *Evidence Checkpoint*: The service
    returns a Geocoding result containing lat/lng coordinates.
-   [ ] **Converts a set of latitude and longitude coordinates back into a
    human-readable address (Reverse Geocoding).** Read
    [return-the-address-for-set-latitude-longitude-coordinates-reverse-geocoding.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-the-address-for-set-latitude-longitude-coordinates-reverse-geocoding.md).
    *Trigger Condition*: When needing to identify the location's address based
    on provided coordinates. *Evidence Checkpoint*: The service returns a
    Reverse Geocoding result containing a formatted address.

#### 🗺️ Feature Module: Maps annotations (Optional - Use-Case Dependent)

-   [ ] **Creates and displays a floating, interactive information bubble (Info
    Window) anchored to a specific location or marker on the map.** Read
    [add-info-window-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-info-window-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When displaying detailed, contextual information overlaying a
    map location. *Evidence Checkpoint*: An Info Window component is
    instantiated and successfully displayed on the map.
-   [ ] **Renders geometrical overlays such as circles, rectangles, polygons, or
    polylines directly on the map surface.** Read
    [add-shape-line-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-shape-line-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When visualizing boundaries, coverage areas, or linear paths.
    *Evidence Checkpoint*: The specified geometric object (Shape or Line)
    renders correctly on the map.
-   [ ] **Adds markers that are scalable and defined using vector graphics
    (e.g., SVG path definitions).** Read
    [add-vector-based-icon-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-vector-based-icon-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When adding highly customized, resolution-independent markers to
    the map. *Evidence Checkpoint*: A vector-based marker icon is displayed at
    the specified coordinates.
-   [ ] **Integrates high-performance, WebGL-powered deck.gl data visualization
    layers onto the map.** Read
    [add-deck-gl-overlays-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-deck-gl-overlays-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When visualizing large-scale datasets (e.g., heatmap,
    scatterplot) requiring accelerated rendering. *Evidence Checkpoint*: A
    deck.gl layer is initialized and successfully overlaid on the map canvas.
-   [ ] **Adds a ground overlay—an image that is anchored to specific
    geographical boundaries on the map.** Read
    [add-overlay-image-grounded-the-surface-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-overlay-image-grounded-the-surface-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When superimposing historical maps, custom maps, or satellite
    imagery segments onto the base map. *Evidence Checkpoint*: The image is
    loaded and displayed correctly within the specified geographical bounding
    box.
-   [ ] **Allows the display of custom map tiles served from a user-defined
    source, replacing or supplementing the base map tiles.** Read
    [add-custom-tile-overlay-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-custom-tile-overlay-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When integrating proprietary map data or specific map styles
    served as tile sets. *Evidence Checkpoint*: Custom map tiles are fetched and
    rendered according to the defined tile URL template.
-   [ ] **Adds a standard pin or graphical icon (Marker) at a specific
    geographical location on the map.** Read
    [add-marker-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-marker-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When needing to highlight a point of interest or location on the
    map. *Evidence Checkpoint*: A standard Marker object is successfully
    rendered on the map.
-   [ ] **Changes the icon, size, and appearance of an existing marker object.**
    Read
    [customize-marker-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-marker-map.md).
    *Dependencies*: `["add-marker-map.md"]` *Trigger Condition*: When default
    marker appearance is insufficient, or different icons are needed for
    different points. *Evidence Checkpoint*: The target marker displays the
    custom icon or styling properties.
-   [ ] **Registers event listeners (e.g., click, drag, hover) on markers to
    trigger application logic upon user interaction.** Read
    [respond-user-interactions-with-markers-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-user-interactions-with-markers-map.md).
    *Dependencies*: `["add-marker-map.md"]` *Trigger Condition*: When markers
    need to be clickable or draggable by the user. *Evidence Checkpoint*: A
    predefined callback function executes when the user interacts with the
    marker.

#### 🗺️ Feature Module: Maps (Optional - Use-Case Dependent)

-   [ ] **Defines a unique Map ID used to centrally manage map configurations,
    styles, and features.** Read
    [create-reusable-map-identifier-store-map-configuration-and-styling-settings.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/create-reusable-map-identifier-store-map-configuration-and-styling-settings.md).
    *Trigger Condition*: When centralized management of map presentation
    (Cloud-based styling) is required. *Evidence Checkpoint*: The map
    initializes successfully using the provided configuration ID.
-   [ ] **Sets up event handlers to respond to changes in the map state, such as
    camera movement, bounds changes, or user clicks on the map canvas.** Read
    [respond-user-interactions-and-events-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-user-interactions-and-events-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When application logic needs to react to map state changes or
    user clicks outside of specific annotations. *Evidence Checkpoint*: A
    defined callback function executes upon a general map interaction event.
-   [ ] **Configures the visibility, placement, and custom behavior of UI
    controls (e.g., zoom, map type, street view pegman) on the map.** Read
    [customize-the-controls-that-appear-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-the-controls-that-appear-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When modifying the default user interface elements provided by
    the map. *Evidence Checkpoint*: The map controls render according to the
    customized configuration.
-   [ ] **Manages the map viewport programmatically, including setting zoom
    levels, center coordinates, and initiating panning or animating movements.**
    Read
    [control-zoom-and-pan-map-camera.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/control-zoom-and-pan-map-camera.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When needing to move the map view in response to user actions or
    application events. *Evidence Checkpoint*: The map camera successfully moves
    to the target location/zoom level.
-   [ ] **Switches the base map layer between standard road map, satellite
    imagery, terrain view, or custom map types.** Read
    [change-the-map-type.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-map-type.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When changing the fundamental visual base layer of the map.
    *Evidence Checkpoint*: The map view updates to display the specified map
    type (e.g., Satellite, Terrain).
-   [ ] **Dynamically sets the color scheme (e.g., Light, Dark, or System
    default) of the base map.** Read
    [change-the-map-color-scheme.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/change-the-map-color-scheme.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When implementing theme switching or responding to user device
    preference changes. *Evidence Checkpoint*: The map's default color palette
    changes to the selected scheme.
-   [ ] **Sets the language and regional bias for displaying map labels and
    geopolitical boundaries.** Read
    [localize-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/localize-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When catering the map display to a specific language or regional
    audience. *Evidence Checkpoint*: Map labels and feature names are rendered
    in the specified language.
-   [ ] **Overlays real-time traffic condition data onto the map.** Read
    [add-traffic-layer-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-traffic-layer-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When users need to see current traffic flow and congestion
    levels. *Evidence Checkpoint*: The Traffic layer object is successfully
    added and visible on the map.
-   [ ] **Overlays public transit network information, including routes and
    stations, onto the map.** Read
    [add-transit-layer-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-transit-layer-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When visualizing public transportation infrastructure. *Evidence
    Checkpoint*: The Transit layer object is successfully added and visible on
    the map.
-   [ ] **Overlays dedicated cycling paths and bicycle-friendly roads onto the
    map.** Read
    [add-bicycling-layer-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-bicycling-layer-map.md).
    *Dependencies*:
    `["add-customizable-interactive-map-web-page-mobile-app.md"]` *Trigger
    Condition*: When providing routing or mapping context for cyclists.
    *Evidence Checkpoint*: The Bicycling layer object is successfully added and
    visible on the map.

#### 🗺️ Feature Module: Photorealistic 3D maps (Optional - Use-Case Dependent)

-   [ ] **Initializes and displays an interactive, high-fidelity 3D map
    environment.** Read
    [add-interactive-photorealistic-map-web-page.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-interactive-photorealistic-map-web-page.md).
    *Trigger Condition*: User needs to render a photorealistic 3D environment
    visualization. *Evidence Checkpoint*: The 'Map' instance initializes in the
    3D 'globe' projection mode.
-   [ ] **Adds a standard marker pin or icon to the photorealistic 3D map
    view.** Read
    [add-marker-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-marker-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When placing static points of interest within the 3D
    environment. *Evidence Checkpoint*: A marker object renders successfully at
    the specified location in the 3D view.
-   [ ] **Customizes the visual properties (icon, color, anchor) of markers used
    in the 3D map.** Read
    [customize-marker-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-marker-photorealistic-map.md).
    *Dependencies*: `["add-marker-photorealistic-map.md"]` *Trigger Condition*:
    When custom visual styling is required for 3D map markers. *Evidence
    Checkpoint*: The 3D marker displays the custom configuration (e.g., custom
    icon image).
-   [ ] **Adds a custom 3D model (e.g., GLB format) to a specific location
    within the photorealistic map.** Read
    [add-model-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-model-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When integrating proprietary or complex 3D assets into
    the map environment. *Evidence Checkpoint*: The custom 3D model loads and
    renders correctly at the geographical anchor point.
-   [ ] **Adds images or custom content overlays (e.g., Info Windows or custom
    HTML) to the 3D map.** Read
    [add-overlay-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-overlay-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When displaying contextual information anchored to
    locations in the 3D view. *Evidence Checkpoint*: The overlay content appears
    correctly positioned relative to a 3D location.
-   [ ] **Adds a line path or route that is rendered in the 3D environment,
    potentially following terrain contours.** Read
    [add-polyline-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-polyline-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When visualizing paths or routes within the 3D map
    context. *Evidence Checkpoint*: A polyline object is successfully rendered
    across the 3D map surface.
-   [ ] **Adds a closed shape (Polygon) that is rendered in the 3D environment,
    allowing for area visualization.** Read
    [add-polygon-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-polygon-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When defining or highlighting geographical areas in the
    3D map. *Evidence Checkpoint*: A polygon object is successfully rendered and
    filled on the 3D map surface.
-   [ ] **Registers handlers for user interactions and camera events specific to
    the 3D map environment.** Read
    [respond-user-interactions-and-events-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-user-interactions-and-events-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When needing to execute logic based on camera angle
    changes, movement, or clicks in the 3D view. *Evidence Checkpoint*: The
    event listener successfully detects and responds to 3D map interactions.
-   [ ] **Configures the appearance and functionality of UI controls (e.g.,
    zoom, rotation) within the 3D map.** Read
    [customize-the-controls-that-appear-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-the-controls-that-appear-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When modifying the user experience controls for the 3D
    viewport. *Evidence Checkpoint*: 3D map controls are displayed or suppressed
    according to the configuration.
-   [ ] **Manages the movement, angle, and animated transitions of the camera
    within the 3D environment.** Read
    [control-camera-path-and-animations-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/control-camera-path-and-animations-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When creating predefined tours or complex camera
    movements in the 3D view. *Evidence Checkpoint*: The 3D camera smoothly
    transitions to the target position/orientation.
-   [ ] **Sets constraints on the camera movement, preventing users from panning
    outside defined geographical bounds or limiting zoom/tilt angles.** Read
    [control-camera-restrictions-photorealistic-map.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/control-camera-restrictions-photorealistic-map.md).
    *Dependencies*: `["add-interactive-photorealistic-map-web-page.md"]`
    *Trigger Condition*: When needing to enforce boundaries or viewing limits
    within the 3D map. *Evidence Checkpoint*: User input respects the configured
    camera limits (e.g., cannot zoom past max tilt).

#### 🗺️ Feature Module: Places (Optional - Use-Case Dependent)

-   [ ] **Searches for a list of Places based on a textual query (e.g.,
    'restaurants near me') and returns their details.** Read
    [return-list-places-and-place-details-based-query-string.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-list-places-and-place-details-based-query-string.md).
    *Trigger Condition*: When executing a text-based search for relevant places.
    *Evidence Checkpoint*: The search function returns an array of Place objects
    matching the query.
-   [ ] **Returns a list of Points of Interest (POIs) near a specified
    geographical location (Nearby Search).** Read
    [return-list-places-and-place-details-near-specific-location.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-list-places-and-place-details-near-specific-location.md).
    *Trigger Condition*: When finding places in the immediate vicinity of a map
    marker or user location. *Evidence Checkpoint*: The service returns an array
    of nearby Place objects.
-   [ ] **Provides predictive text suggestions for places, addresses, or queries
    as the user types.** Read
    [return-autocomplete-results-about-places-based-query-string.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-autocomplete-results-about-places-based-query-string.md).
    *Trigger Condition*: When providing interactive, real-time input suggestions
    for a search field. *Evidence Checkpoint*: The API returns place prediction
    results based on the partial input string.
-   [ ] **Retrieves comprehensive data (address, phone number, hours, website)
    for a single place using its Place ID.** Read
    [return-detailed-information-about-specific-place.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-detailed-information-about-specific-place.md).
    *Trigger Condition*: When needing full metadata for a place identified via
    search or autocomplete. *Evidence Checkpoint*: The service returns a Place
    object containing the requested data fields.
-   [ ] **Retrieves metadata and references necessary to display publicly shared
    photos associated with a Place.** Read
    [return-photos-specific-place.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-photos-specific-place.md).
    *Trigger Condition*: When needing to display visual content for a specific
    place. *Evidence Checkpoint*: The Place details response contains photo
    references or URLs.
-   [ ] **Requests photo images retrieved from a Place reference to be resized
    to specified dimensions.** Read
    [resize-place-photos.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/resize-place-photos.md).
    *Dependencies*: `["return-photos-specific-place.md"]` *Trigger Condition*:
    When optimizing photo size for display responsiveness or bandwidth
    constraints. *Evidence Checkpoint*: The resulting image URL returns a photo
    rendered at the specified width/height.
-   [ ] **Retrieves user ratings, review snippets, and detailed review data for
    a specific Place.** Read
    [return-ratings-and-reviews-for-specific-place.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-ratings-and-reviews-for-specific-place.md).
    *Trigger Condition*: When displaying social proof or customer feedback about
    a business or POI. *Evidence Checkpoint*: The Place details response
    includes numerical ratings and text review content.
-   [ ] **Integrates a fully interactive UI widget that provides place search
    and address autocomplete functionality.** Read
    [add-autocomplete-widget-web-page-app-that-returns-results-about.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-autocomplete-widget-web-page-app-that-returns-results-about.md).
    *Trigger Condition*: When implementing a search input box with predictive
    address/place completion. *Evidence Checkpoint*: The Autocomplete widget
    attaches to the input element and displays predictive dropdowns.
-   [ ] **Allows selective specification of the fields (data types) returned in
    Place Details responses to manage API cost and payload size.** Read
    [specify-the-data-fields-included-place-information-responses.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-the-data-fields-included-place-information-responses.md).
    *Trigger Condition*: When optimizing API calls by requesting only necessary
    place information data. *Evidence Checkpoint*: The Place object in the
    response contains only the requested fields (e.g., name, geometry).
-   [ ] **Filters Place search and autocomplete results to only include specific
    categories of places (e.g., 'restaurants', 'hospitals').** Read
    [specify-the-place-types-include-place-information-responses.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/specify-the-place-types-include-place-information-responses.md).
    *Trigger Condition*: When restricting search scope to business types or
    established geographical entities. *Evidence Checkpoint*: Place search
    results only contain places that match the defined type filter.

#### 🗺️ Feature Module: Places UI Kit (Optional - Use-Case Dependent)

-   [ ] **Adds a pre-built, standardized UI component showing AI-generated
    summaries and user reviews for a place.** Read
    [add-element-that-displays-ai-powered-summaries-and-reviews-about-specific.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-element-that-displays-ai-powered-summaries-and-reviews-about-specific.md).
    *Trigger Condition*: When needing to display dynamic, aggregated AI/user
    review content for a place using a compliant UI component. *Evidence
    Checkpoint*: The Review Summary UI component renders successfully with place
    data.
-   [ ] **Applies custom CSS styling to Places UI Kit components for visual
    integration into the host application.** Read
    [apply-css-styling-place-data-element.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/apply-css-styling-place-data-element.md).
    *Trigger Condition*: When adjusting the look and feel of the Places UI
    components. *Evidence Checkpoint*: The UI Kit element adopts the custom CSS
    properties provided by the application.
-   [ ] **Uses a customization tool or configuration object to define appearance
    and behavior settings for Places UI Kit elements.** Read
    [customize-place-data-element-styling-and-configurations-with-element-customization.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-place-data-element-styling-and-configurations-with-element-customization.md).
    *Trigger Condition*: When applying custom configurations to Places UI Kit
    components. *Evidence Checkpoint*: The UI element loads with the specified
    color palettes, fonts, or feature toggles.
-   [ ] **Adds a pre-built UI component that displays static and dynamic
    information (details, hours, photos) about a single place.** Read
    [add-element-that-displays-information-about-specific-place-web-page.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-element-that-displays-information-about-specific-place-web-page.md).
    *Trigger Condition*: When needing a clean, compliant UI representation of a
    Place's comprehensive details. *Evidence Checkpoint*: The Place Details UI
    component successfully renders with loaded metadata.
-   [ ] **Adds a UI component that executes a textual query and displays the
    results as a list of places.** Read
    [add-element-that-displays-list-places-based-query-string-web.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-element-that-displays-list-places-based-query-string-web.md).
    *Trigger Condition*: When presenting search results for a text query in a
    structured list view. *Evidence Checkpoint*: The Place List UI component
    renders an accurate list corresponding to the query.
-   [ ] **Adds a UI component that displays a dynamic list of places located
    near a specified geographical point.** Read
    [add-element-that-displays-list-places-near-specific-location-web.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-element-that-displays-list-places-near-specific-location-web.md).
    *Trigger Condition*: When implementing a 'What's nearby' feature using a
    compliant list view. *Evidence Checkpoint*: The Place List UI component
    displays places located within the specified proximity.
-   [ ] **Adds a streamlined UI autocomplete field that suggests and returns
    Google Place IDs.** Read
    [add-basic-autocomplete-element-web-page-app-that-returns-google.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-basic-autocomplete-element-web-page-app-that-returns-google.md).
    *Trigger Condition*: When needing a simple, compliant input field solely
    focused on returning Place Identifiers. *Evidence Checkpoint*: The
    Autocomplete input widget returns a Place ID upon selection.

#### 🗺️ Feature Module: Street View (Optional - Use-Case Dependent)

-   [ ] **Adds visual markers or custom overlays anchored to specific
    coordinates within the Street View panorama.** Read
    [add-marker-overlay-google-street-view.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/add-marker-overlay-google-street-view.md).
    *Dependencies*:
    `["add-configurable-interactive-google-street-view-web-page-mobile-app.md"]`
    *Trigger Condition*: When annotating points of interest directly within the
    360-degree view. *Evidence Checkpoint*: An overlay object renders correctly
    positioned in the Street View viewport.
-   [ ] **Sets up event handlers to respond to user interactions (e.g., POV
    change, click) within the Street View panorama.** Read
    [respond-user-interactions-and-events-google-street-view.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/respond-user-interactions-and-events-google-street-view.md).
    *Dependencies*:
    `["add-configurable-interactive-google-street-view-web-page-mobile-app.md"]`
    *Trigger Condition*: When application logic must react to user navigation or
    interaction inside the panorama. *Evidence Checkpoint*: The defined event
    listener executes upon user movement or interaction in Street View.
-   [ ] **Configures the visibility of UI controls (e.g., zoom, address readout,
    links) within the Street View panorama.** Read
    [customize-the-controls-that-appear-google-street-view.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/customize-the-controls-that-appear-google-street-view.md).
    *Dependencies*:
    `["add-configurable-interactive-google-street-view-web-page-mobile-app.md"]`
    *Trigger Condition*: When modifying the user interface elements of the
    Street View component. *Evidence Checkpoint*: Street View controls are
    displayed or hidden according to the configuration.
-   [ ] **Retrieves the metadata (location, links, pitch, heading) for the
    nearest available Street View panorama to a location.** Read
    [return-google-street-view-panorama-for-specific-location.md](https://www.gstatic.com/googlemapsplatform-agent-skills/maps-javascript-api-javascript/references/return-google-street-view-panorama-for-specific-location.md).
    *Trigger Condition*: When needing programmatic access to panorama existence
    and metadata before displaying it. *Evidence Checkpoint*: The service
    returns a valid Street View Panorama data object.
