import SwiftUI
import WidgetKit

/// Entry point of the YardLiveActivity widget extension: only the order-tracking Live Activity.
@main
struct YardLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        YardOrderLiveActivity()
    }
}
