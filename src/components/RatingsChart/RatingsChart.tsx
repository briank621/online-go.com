/*
 * Copyright (C) 2012-2017  Online-Go.com
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/* This code was derived from https://github.com/billneff79/d3-stock which
 * is a d3.js v4 port of https://github.com/arnauddri/d3-stock */

import * as d3 from "d3";
import * as moment from "moment";
import * as React from "react";
import data from "data";
import {Link} from "react-router";
import {termination_socket} from 'sockets';
import {_, pgettext, interpolate} from "translate";
import {PersistentElement} from 'PersistentElement';
import {RatingEntry, makeRatingEntry} from './RatingEntry';
import {
    rank_to_rating,
    rating_to_rank,
    get_handicap_adjustment,
    rankString
} from 'rank_utils';

interface RatingsChartProperties {
    playerId: number;
    speed: 'overall' | 'blitz' | 'live' | 'correspondence';
    size: 0 | 9 | 13 | 19;
}


const date_bisector = d3.bisector((d:RatingEntry) => { return d.ended; }).left;
let format_date = (d:Date) => moment(d).format('ll');
const margin   = {top: 30, right: 20, bottom: 100, left: 20};
const margin2  = {top: 210, right: 20, bottom: 20, left: 20};
const chart_min_width = 64;
const chart_height = 283;
const winloss_bars_height = 155;
const height   = chart_height - margin.top - margin.bottom;
const secondary_charts_height  = chart_height - margin2.top - margin2.bottom;


export class RatingsChart extends React.PureComponent<RatingsChartProperties, any> {
    container;
    chart_div;
    svg;
    clip;
    resize_debounce;
    rating_graph;
    timeline_graph;
    legend;
    dateLegend;
    dateLegendBackground;
    dateLegendText;
    range_label;
    date_extents;
    winloss_graphs:Array<any> = [];
    winloss_bars:Array<any> = [];
    game_entries:Array<RatingEntry>;
    games_by_month:Array<RatingEntry>;
    games_by_day:Array<RatingEntry>;

    ratings_x      = d3.scaleTime();
    timeline_x     = d3.scaleTime();
    ratings_y      = d3.scaleLinear();
    timeline_y     = d3.scaleLinear();
    outcomes_y     = d3.scaleLinear();

    selected_axis  = d3.axisBottom(this.ratings_x);
    timeline_axis  = d3.axisBottom(this.timeline_x);
    rating_axis    = d3.axisLeft(this.ratings_y);
    rank_axis      = d3.axisRight(this.ratings_y);

    rating_line    = d3.line<RatingEntry>()
                       .curve(d3.curveLinear)
                       .x((d:RatingEntry) => this.ratings_x(d.ended))
                       .y((d:RatingEntry) => this.ratings_y(d.rating));

    deviation_area = d3.area<RatingEntry>()
                       .curve(d3.curveBasis)
                       .x0((d:RatingEntry) => this.ratings_x(d.ended))
                       .x1((d:RatingEntry) => this.ratings_x(d.ended))
                       .y0((d:RatingEntry) => this.ratings_y(Math.min(d.starting_rating, d.rating) - d.deviation))
                       .y1((d:RatingEntry) => this.ratings_y(Math.max(d.starting_rating, d.rating) + d.deviation));

    timeline_area  = d3.area<RatingEntry>()
                       .curve(d3.curveMonotoneX)
                       .x((d:RatingEntry) => this.timeline_x(d.ended))
                       .y0(secondary_charts_height)
                       .y1((d:RatingEntry) => this.timeline_y(d.rating));

    deviation_chart;
    rating_chart;
    x_axis_date_labels;
    y_axis_rank_labels;
    y_axis_rating_labels;
    helper;
    helperText;
    ratingTooltip;
    mouseArea;
    verticalCrosshairLine;
    horizontalCrosshairLine;
    timeline_chart;
    timeline_axis_labels;
    brush;
    width;
    height;

    constructor(props) {
        super(props);
        this.state = { };
        this.chart_div = $("<div>")[0];
    }
    componentDidMount() {{{
        this.initialize();
        this.resize(true);
    }}}
    componentDidUpdate(prevProps, prevState) {{{
        d3.tsv(`/termination-api/player/${this.props.playerId}/rating-history?speed=${this.props.speed}&size=${this.props.size}`, makeRatingEntry, this.setData);
    }}}
    componentWillUnmount() {{{
        this.deinitialize();
    }}}
    componentWillReceiveProps(nextProps) {{{
    }}}
    initialize() {{{
        let sizes = this.chart_sizes();
        let width = this.width = sizes.width;
        this.height = height;

        this.ratings_x.range([0, width]);
        this.timeline_x.range([0, width]);
        this.ratings_y.range([height, 0]);
        this.timeline_y.range([secondary_charts_height, 0]);
        this.outcomes_y.range([60, 0]);


        this.rank_axis.tickFormat((rating:number) => rankString(Math.round(rating_to_rank(rating))));
        this.svg = d3.select(this.chart_div)
            .append('svg')
            .attr('class', 'chart')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom + 60);


        this.clip = this.svg.append('defs')
            .append('clipPath')
            .attr('id', 'clip')
            .append('rect')
            .attr('width', width)
            .attr('height', height);


        this.rating_graph = this.svg.append('g')
            .attr('class', 'focus')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');


        for (let i = 0; i < 4; ++i) {
            this.winloss_graphs.push(this.svg.append('g')
                .attr('class', 'volume')
                .attr('clip-path', 'url(#clip)')
                .attr('transform', 'translate(' + margin.left + ',' + (margin.top + 60 + 20) + ')')
            );
        }

        this.timeline_graph = this.svg.append('g')
            .attr('class', 'context')
            .attr('transform', 'translate(' + margin2.left + ',' + (margin2.top + 60) + ')');

        this.legend = this.svg.append('g')
            .attr('class', 'chart__legend')
            .attr('transform', 'translate(' + margin2.left + ', 10)')
            .attr('width', width)
            .attr('height', 30);

        this.dateLegend = this.svg.append('g')
            .attr('class', 'chart__dateLegend')
            .style('text-anchor', 'middle')
            .style('display', 'none')
            .attr('width', width)
            .attr('height', 30);


        this.dateLegendBackground = this.dateLegend.append('rect')
            .attr('class', 'chart__dateLegendBackground')
            .attr('width', 70)
            .attr('height', 20)
            .attr('x', -35)
            .attr('y', -10)
            .attr('rx', 10);

        this.dateLegendText = this.dateLegend.append('text')
            .attr('class', 'chart__dateLegendText')
            .attr('y', 3);

        this.legend.append('text')
            .attr('class', 'chart__symbol')
            .text('NASDAQ: AAPL');

        this.range_label = this.legend.append('text')
            .style('text-anchor', 'end')
            .attr('transform', 'translate(' + width + ', 0)');


        this.deviation_chart = this.rating_graph.append('path')
            .attr('clip-path', 'url(#clip)')
            .attr('class', 'deviation-area');

        this.rating_chart = this.rating_graph.append('path')
            .attr('class', 'chart__line line chart__rating--focus');

        this.x_axis_date_labels = this.rating_graph.append('g')
            .attr('class', 'x axis')
            .attr('transform', 'translate(0 ,' + height + ')');

        this.y_axis_rating_labels = this.rating_graph.append('g')
            .attr('class', 'y axis')
            .attr('transform', 'translate(0, 0)');

        this.y_axis_rank_labels = this.rating_graph.append('g')
            .attr('class', 'y axis')
            .attr('transform', 'translate(' + (width - 10) + ', 0)');



        this.helper = this.rating_graph.append('g')
            .attr('class', 'chart__helper')
            .style('text-anchor', 'end')
            .attr('transform', 'translate(' + width + ', 0)');

        this.helperText = this.helper.append('text');

        this.ratingTooltip = this.rating_graph.append('g')
            .attr('class', 'chart__tooltip--rating')
            .append('circle')
            .style('display', 'none')
            .attr('r', 2.5);

        this.verticalCrosshairLine = this.rating_graph.append('g')
            .attr('class', 'chart__tooltip--rating-crosshairs')
            .append('line')
            .style('display', 'none')
            .attr('x0', 0)
            .attr('y0', 0)
            .attr('x1', 0)
            .attr('y1', height);

        this.horizontalCrosshairLine = this.rating_graph.append('g')
            .attr('class', 'chart__tooltip--rating-crosshairs')
            .append('line')
            .style('display', 'none')
            .attr('x0', 0)
            .attr('y0', 0)
            .attr('y1', 0)
            .attr("stroke-width", 2)
            .attr("stroke", "black")
            .attr('x1', width);

        let self = this;
        this.mouseArea = this.svg.append('g')
            .attr('class', 'chart__mouse')
            .append('rect')
            .attr('class', 'chart__overlay')
            .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')')
            .attr('width', width)
            .attr('height', height)
            .on('mouseover', () => {
                this.helper.style('display', null);
                this.dateLegend.style('display', null);
                this.ratingTooltip.style('display', null);
                //deviationTooltip.style('display', null);
                this.verticalCrosshairLine.style('display', null);
                this.horizontalCrosshairLine.style('display', null);
            })
            .on('mouseout', () => {
                this.helper.style('display', 'none');
                this.dateLegend.style('display', 'none');
                this.ratingTooltip.style('display', 'none');
                //deviationTooltip.style('display', 'none');
                this.verticalCrosshairLine.style('display', 'none');
                this.horizontalCrosshairLine.style('display', 'none');
            })
            .on('mousemove', function() {
                /* tslint:disable */
                let x0 = self.ratings_x.invert(d3.mouse(this as d3.ContainerElement)[0]);
                /* tslint:enable */

                let i = date_bisector(self.games_by_day, x0, 1);
                let d0 = self.games_by_day[i - 1];
                let d1 = self.games_by_day[i];

                if (!d0 || !d1) {
                    return;
                }

                let d = x0.getTime() - d0.ended.getTime() > d1.ended.getTime() - x0.getTime() ? d1 : d0;
                self.helperText.text(format_date(new Date(d.ended)) + ' - rating: ' + d.rating + ' Dev.: ' + d.deviation);
                self.dateLegendText.text(format_date(new Date(d.ended)));
                self.dateLegend.attr('transform', 'translate(' + (self.ratings_x(d.ended) + margin.left)  + ',' + (margin.top + height + 10) + ')');
                self.ratingTooltip.attr('transform', 'translate(' + self.ratings_x(d.ended) + ',' + self.ratings_y(d.rating) + ')');
                //deviationTooltip.attr('transform', 'translate(' + self.ratings_x(d.ended) + ',' + self.ratings_y(d.rating) + ')');
                self.verticalCrosshairLine.attr('transform', 'translate(' + self.ratings_x(d.ended) + ', 0)');
                self.horizontalCrosshairLine.attr('transform', 'translate(0, ' + self.ratings_y(d.rating) + ')');
            });

        this.timeline_chart = this.timeline_graph.append('path')
            .attr('class', 'chart__area area');
        this.timeline_axis_labels = this.timeline_graph.append('g')
            .attr('class', 'x axis chart__axis--context')
            .attr('transform', 'translate(0,' + (secondary_charts_height - 22) + ')')
            .attr('y', 0);

        this.brush = d3.brushX()
            .extent([[0, 0], [width, secondary_charts_height]])
            .on('brush', this.onTimelineBrush)
            .on('end', this.onTimelineBrush);

        this.timeline_graph.append('g')
            .attr('class', 'x brush')
            .call(this.brush);

        $(window).on("resize", this.resize as () => void);

        d3.tsv(`/termination-api/player/${this.props.playerId}/rating-history?speed=${this.props.speed}&size=${this.props.size}`, makeRatingEntry, this.setData);
    }}}
    deinitialize() {{{
        $(window).off("resize", this.resize as () => void);
        if (this.resize_debounce) {
            clearTimeout(this.resize_debounce);
            this.resize_debounce = null;
        }

    }}}
    chart_sizes() {{{
        let width = Math.max(chart_min_width, $(this.container).width()  - margin.left - margin.right);
        return {
            width: width,
            height: height,
        };
    }}}
    resize = (no_debounce:boolean = false) => {{{
        if (this.resize_debounce) {
            clearTimeout(this.resize_debounce);
            this.resize_debounce = null;
        }

        if (!no_debounce) {
            this.resize_debounce = setTimeout(() => this.resize(true), 10);
            return;
        }

        let sizes = this.chart_sizes();

        let width = this.width = sizes.width;
        this.height = height;

        this.ratings_x.range([0, width]);
        this.timeline_x.range([0, width]);
        this.ratings_y.range([height, 0]);
        this.timeline_y.range([secondary_charts_height, 0]);
        this.outcomes_y.range([60, 0]);

        this.svg.attr('width', width + margin.left + margin.right);
        this.svg.attr('height', height + margin.top + margin.bottom + 60);
        this.clip.attr('width', width);
        this.clip.attr('height', height);

        this.legend.attr('width', width);
        this.legend.attr('height', 30);

        this.dateLegend.attr('width', width);
        this.dateLegend.attr('height', 30);
        this.range_label.attr('transform', 'translate(' + width + ', 0)');
        this.x_axis_date_labels.attr('transform', 'translate(0 ,' + height + ')');
        this.y_axis_rating_labels.attr('transform', 'translate(0, 0)');
        this.y_axis_rank_labels.attr('transform', 'translate(' + (width - 10) + ', 0)');

        this.verticalCrosshairLine.attr('y1', height);
        this.helper.attr('transform', 'translate(' + width + ', 0)');
        this.horizontalCrosshairLine.attr('x1', width);
        this.mouseArea.attr('width', width);
        this.mouseArea.attr('height', height);
        this.timeline_axis_labels .attr('transform', 'translate(0,' + (secondary_charts_height - 22) + ')');
        this.brush.extent([[0, 0], [width, secondary_charts_height]]);

        try {

            this.timeline_chart
                .datum(this.games_by_day)
                .attr('d', this.timeline_area as any);

            this.onTimelineBrush();

        } catch (e) {
            console.error(e);
        }
    }}}
    setData = (err, data) => {{{
        this.game_entries = data;
        this.game_entries.reverse();

        /* Group into days and process information like starting/ended rating/rank, increase/decrease, etc */
        this.games_by_day = new Array<RatingEntry>();
        this.games_by_month = new Array<RatingEntry>();
        const daykey = (d:Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
        const monthkey = (d:Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}`;

        if (this.game_entries.length > 0) {
            let last_month_key = '';
            let last_day_key = '';
            let cur_day:RatingEntry = null;
            let cur_month:RatingEntry = null;
            for (let d of this.game_entries) {
                let day_key = daykey(d.ended);
                if (last_day_key !== day_key) {
                    last_day_key = day_key;
                    cur_day = d.copy();
                    cur_day.starting_rating = cur_day.rating;
                    cur_day.starting_deviation = cur_day.deviation;
                    cur_day.count = 1;
                    cur_day.increase = null;
                    this.games_by_day.push(cur_day);
                } else {
                    cur_day.merge(d);
                }

                if (this.games_by_day.length >= 2) {
                    cur_day.increase = this.games_by_day[this.games_by_day.length - 2].rating < cur_day.rating;
                }

                let month_key = monthkey(d.ended);
                if (last_month_key !== month_key) {
                    last_month_key = month_key;
                    cur_month = d.copy();
                    this.games_by_month.push(cur_month);
                } else {
                    cur_month.merge(d);
                }
                if (this.games_by_month.length >= 2) {
                    cur_month.increase = this.games_by_month[this.games_by_month.length - 2].rating < cur_month.rating;
                } else {
                    cur_month.increase = null;
                }
            }
        }

        /* Plot */
        let date_range:any = d3.extent(this.game_entries.map((d:RatingEntry) => { return d.ended; }));

        this.ratings_x.domain(date_range);
        let lower = Math.min.apply(null, this.game_entries.map((d:RatingEntry) => Math.min(d.starting_rating, d.rating) - d.deviation));
        let upper = Math.max.apply(null, this.game_entries.map((d:RatingEntry) => Math.max(d.starting_rating, d.rating) + d.deviation));
        this.ratings_y.domain([lower * 0.95, upper * 1.05]);
        this.outcomes_y.domain(d3.extent(this.games_by_month.map((d:RatingEntry) => { return d.count; })) as any);
        this.timeline_x.domain(this.ratings_x.domain());
        this.timeline_y.domain(d3.extent(this.game_entries.map((d:RatingEntry) => { return d.rating; })) as any);
        this.date_extents = this.timeline_x.range().map(this.timeline_x.invert, this.timeline_x);
        this.range_label.text(format_date(new Date(date_range[0])) + ' - ' + format_date(new Date(date_range[1])));
        this.rating_graph.append('g').attr('class', 'y chart__grid'); /* TODO: can we remove this? */
        this.deviation_chart
            .datum(this.games_by_day)
            .attr('d', this.deviation_area as any);
        this.rating_chart
            .datum(this.games_by_day)
            .attr('d', this.rating_line as any);
        this.x_axis_date_labels.call(this.selected_axis);
        this.y_axis_rating_labels.call(this.rating_axis);
        this.y_axis_rank_labels.call(this.rank_axis);

        this.timeline_chart
            .datum(this.games_by_day)
            .attr('d', this.timeline_area as any);
        this.timeline_axis_labels
            .call(this.timeline_axis);

        const W = (d:RatingEntry, alpha:number) => {
            let w = this.getUTCMonthWidth(d.ended) * alpha;
            return isFinite(w) ? w : 0;
        };
        const X = (d:RatingEntry, alpha:number) => {
            let start = new Date(d.ended.getUTCFullYear(), d.ended.getUTCMonth());
            let end = new Date(d.ended.getUTCFullYear(), d.ended.getUTCMonth());
            end.setMonth(end.getMonth() + 1);
            let s = start.getTime();
            let e = end.getTime();
            let x = this.ratings_x(s * (1 - alpha) + e * alpha);
            return isFinite(x) ? x : 0;
        };
        const H = (count:number) => {
            return Math.max(0, 65 - this.outcomes_y(count));
        };
        const Y = (count:number) => {
            return winloss_bars_height - Math.max(0, 65 - this.outcomes_y(count));
        };

        this.winloss_bars.push(
            this.winloss_graphs[0].selectAll('rect')
                .data(this.games_by_month)
                .enter().append('rect')
                .attr('class', 'weak_wins')
                .attr('x', (d:RatingEntry) => X(d, 0))
                .attr('y', (d:RatingEntry) => Y(d.count))
                .attr('width', (d:RatingEntry) => W(d, d.weak_wins / (d.wins || 1)))
                .attr('height', (d:RatingEntry) => H(d.wins))
        );
        this.winloss_bars.push(
            this.winloss_graphs[1].selectAll('rect')
                .data(this.games_by_month)
                .enter().append('rect')
                .attr('class', 'strong_wins')
                .attr('x', (d:RatingEntry) => X(d, d.weak_wins / (d.wins || 1)))
                .attr('y', (d:RatingEntry) => Y(d.count))
                .attr('width', (d:RatingEntry) => W(d, d.strong_wins / (d.wins || 1)))
                .attr('height', (d:RatingEntry) => H(d.wins))
        );
        this.winloss_bars.push(
            this.winloss_graphs[2].selectAll('rect')
                .data(this.games_by_month)
                .enter().append('rect')
                .attr('class', 'weak_losses')
                .attr('x', (d:RatingEntry) => X(d, 0))
                .attr('y', (d:RatingEntry) => Y(d.count - d.wins))
                .attr('width', (d:RatingEntry) => W(d, d.weak_losses / (d.losses || 1)))
                .attr('height', (d:RatingEntry) => H(d.losses))
        );
        this.winloss_bars.push(
            this.winloss_graphs[3].selectAll('rect')
                .data(this.games_by_month)
                .enter().append('rect')
                .attr('class', 'strong_losses')
                .attr('x', (d:RatingEntry) => X(d, d.weak_losses / (d.losses || 1)))
                .attr('y', (d:RatingEntry) => Y(d.count - d.wins))
                .attr('width', (d:RatingEntry) => W(d, d.strong_losses / (d.losses || 1)))
                .attr('height', (d:RatingEntry) => H(d.losses))
        );
    }}}
    getUTCMonthWidth(d:Date):number {{{
        let days_in_month = Math.round((new Date(d.getUTCFullYear(), d.getUTCMonth() + 1).getTime() - new Date(d.getUTCFullYear(), d.getUTCMonth()).getTime()) / 86400);

        let s = this.date_extents[0];
        let e = this.date_extents[1];
        s = new Date(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
        e = new Date(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
        let days_in_range = Math.round((e.getTime() - s.getTime()) / 86400);

        return this.width * (days_in_month / days_in_range);
    }}}
    onTimelineBrush = () => {{{
        this.date_extents = (d3.event && d3.event.selection) || this.timeline_x.range();
        this.date_extents = this.date_extents.map(this.timeline_x.invert, this.timeline_x);

        this.ratings_x.domain(this.date_extents);

        let lower = Math.min.apply(null, this.game_entries.map((d:RatingEntry) => Math.min(d.starting_rating, d.rating) - d.deviation));
        let upper = Math.max.apply(null, this.game_entries.map((d:RatingEntry) => Math.max(d.starting_rating, d.rating) + d.deviation));

        let l = Math.min.apply(null, this.game_entries.map((d:RatingEntry) => (d.ended.getTime() >= this.date_extents[0].getTime() && d.ended.getTime() <= this.date_extents[1].getTime()) ? (Math.min(d.starting_rating, d.rating) - d.deviation) : upper));
        let u = Math.max.apply(null, this.game_entries.map((d:RatingEntry) => (d.ended.getTime() >= this.date_extents[0].getTime() && d.ended.getTime() <= this.date_extents[1].getTime()) ? (Math.max(d.starting_rating, d.rating) + d.deviation) : lower));
        this.ratings_y.domain([l * 0.95, u * 1.05]);

        this.range_label.text(format_date(new Date(this.date_extents[0])) + ' - ' + format_date(new Date(this.date_extents[1])));

        const W = (d:RatingEntry, alpha:number) => {
            let w = this.getUTCMonthWidth(d.ended) * alpha;
            return isFinite(w) ? w : 0;
        };
        const X = (d:RatingEntry, alpha:number) => {
            let start = new Date(d.ended.getUTCFullYear(), d.ended.getUTCMonth());
            let end = new Date(d.ended.getUTCFullYear(), d.ended.getUTCMonth());
            end.setMonth(end.getMonth() + 1);
            let s = start.getTime();
            let e = end.getTime();
            let x = this.ratings_x(s * (1 - alpha) + e * alpha);
            return isFinite(x) ? x : 0;
        };

        this.winloss_bars[0]
                .attr('x', (d:RatingEntry) => X(d, 0))
                .attr('width', (d:RatingEntry) => W(d, d.weak_wins / (d.wins || 1)));
        this.winloss_bars[1]
                .attr('x', (d:RatingEntry) => X(d, d.weak_wins / (d.wins || 1)))
                .attr('width', (d:RatingEntry) => W(d, d.strong_wins / (d.wins || 1)));
        this.winloss_bars[2]
                .attr('x', (d:RatingEntry) => X(d, 0))
                .attr('width', (d:RatingEntry) => W(d, d.weak_losses / (d.losses || 1)));
        this.winloss_bars[3]
                .attr('x', (d:RatingEntry) => X(d, d.weak_losses / (d.losses || 1)))
                .attr('width', (d:RatingEntry) => W(d, d.strong_losses / (d.losses || 1)));

        this.rating_chart.attr('d', this.rating_line as any);
        this.deviation_chart.attr('d', this.deviation_area as any);
        this.rating_graph.select('.x.axis').call(this.selected_axis);
        this.y_axis_rating_labels.call(this.rating_axis);
        this.y_axis_rank_labels.call(this.rank_axis);
    }}}

    render() {{{
        return (
            <div ref={(e) => this.container = e} className="RatingsChart">
                <PersistentElement elt={this.chart_div}/>
            </div>
        );
    }}}
}
